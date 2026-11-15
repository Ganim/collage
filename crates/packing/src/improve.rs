//! Phase two: while the layout uses more sheets than the area lower bound, try to remove
//! one.
//!
//! Each round first moves the emptiest sheet's items, biggest first, into any other sheet
//! that can take them (repacking that sheet). If items are left, it pools two or three
//! sheets, least area first, and repacks the pool into one sheet fewer: shuffled MaxRects
//! orders first, then, for small pools, an exact search (one sheet) or every split into
//! two (two sheets). All work is counted against a budget scaled by the
//! effort, so the result is deterministic and the time bounded.

use crate::exact::{self, Fit};
use crate::maxrects::{Bin, Heuristic};
use crate::{shuffle, sorted_orders, Inflated, Packed, Slot, HEURISTICS};

/// Work units per effort, one unit per MaxRects insert or exact search node.
const WORK: u64 = 800_000;
/// Shuffled orders tried by each repack, per effort.
const TRIES: usize = 16;
/// Pools this small get an exact search for one sheet...
const EXACT_ITEMS: usize = 12;
/// ...within this many nodes per effort, or a quarter of the work left if that is more.
const EXACT_NODES: u64 = 60_000;
/// Pools this small get every split into two sheets.
const SPLIT_ITEMS: usize = 10;
/// Pools hold at most this many sheets plus one.
const POOL_SHEETS: usize = 2;
/// Pools are drawn from this many of the least used sheets.
const POOL_FROM: usize = 40;
/// Pools tried per size, per effort.
const COMBOS: usize = 120;

struct Search<'a> {
    fitting: &'a [Inflated],
    area: (u32, u32),
    cap: u64,
    rng: u32,
    effort: u32,
    work: u64,
    limit: u64,
}

impl Search<'_> {
    fn spent(&self) -> bool {
        self.work >= self.limit
    }

    fn area_of(&self, items: &[usize]) -> u64 {
        items.iter().map(|&i| self.fitting[i].area()).sum()
    }

    /// Orders to try for `items`: the sorted ones, then `tries` shuffles.
    fn orders(&mut self, items: &[usize]) -> Vec<Vec<Inflated>> {
        let list: Vec<Inflated> = items.iter().map(|&i| self.fitting[i]).collect();
        let mut orders = sorted_orders(&list);
        let mut shuffled = list;
        for _ in 0..TRIES * self.effort as usize {
            shuffle(&mut shuffled, &mut self.rng);
            orders.push(shuffled.clone());
        }
        orders
    }

    /// Places all `items` on one sheet; slots follow `items`.
    fn pack_one(&mut self, items: &[usize]) -> Option<Vec<Slot>> {
        if self.area_of(items) > self.cap {
            return None;
        }
        for order in self.orders(items) {
            for &heuristic in &HEURISTICS {
                if self.spent() {
                    return None;
                }
                let mut bin = Bin::new(self.area.0, self.area.1);
                let mut slots = vec![(0, 0, false); self.fitting.len()];
                let mut ok = true;
                for it in &order {
                    self.work += 1;
                    match bin.insert(it.w, it.h, heuristic) {
                        Some(s) => slots[it.index] = (s.x, s.y, s.rotated),
                        None => {
                            ok = false;
                            break;
                        }
                    }
                }
                if ok {
                    return Some(items.iter().map(|&i| slots[i]).collect());
                }
            }
        }
        if items.len() <= EXACT_ITEMS && !self.spent() {
            let rects: Vec<(u32, u32)> = items
                .iter()
                .map(|&i| (self.fitting[i].w, self.fitting[i].h))
                .collect();
            let left = self.limit - self.work;
            let allowed = (EXACT_NODES * self.effort as u64).max(left / 4).min(left);
            let mut budget = allowed;
            let fit = exact::fit(&rects, self.area, &mut budget);
            self.work += allowed - budget;
            if let Fit::Yes(slots) = fit {
                return Some(slots);
            }
        }
        None
    }

    /// Places all `items` on at most `sheets` sheets.
    fn pack_into(&mut self, items: &[usize], sheets: usize) -> Option<Vec<Packed>> {
        if self.area_of(items) > self.cap * sheets as u64 {
            return None;
        }
        if sheets == 1 {
            let slots = self.pack_one(items)?;
            return Some(vec![Packed::new(items.to_vec(), slots, self.fitting)]);
        }
        for order in self.orders(items) {
            for &heuristic in &HEURISTICS {
                if self.spent() {
                    return None;
                }
                if let Some(bins) = self.first_fit(&order, heuristic, sheets) {
                    return Some(bins);
                }
            }
        }
        if sheets == 2 && items.len() <= SPLIT_ITEMS {
            return self.split_two(items);
        }
        None
    }

    /// First-fit MaxRects onto at most `sheets` sheets.
    fn first_fit(
        &mut self,
        order: &[Inflated],
        heuristic: Heuristic,
        sheets: usize,
    ) -> Option<Vec<Packed>> {
        let mut bins: Vec<Bin> = Vec::new();
        let mut content: Vec<(Vec<usize>, Vec<Slot>)> = Vec::new();
        for it in order {
            let mut placed = false;
            for (bin, (items, slots)) in bins.iter_mut().zip(content.iter_mut()) {
                self.work += 1;
                if let Some(s) = bin.insert(it.w, it.h, heuristic) {
                    items.push(it.index);
                    slots.push((s.x, s.y, s.rotated));
                    placed = true;
                    break;
                }
            }
            if !placed {
                if bins.len() == sheets {
                    return None;
                }
                let mut bin = Bin::new(self.area.0, self.area.1);
                self.work += 1;
                let s = bin.insert(it.w, it.h, heuristic)?;
                bins.push(bin);
                content.push((vec![it.index], vec![(s.x, s.y, s.rotated)]));
            }
        }
        Some(
            content
                .into_iter()
                .map(|(items, slots)| Packed::new(items, slots, self.fitting))
                .collect(),
        )
    }

    /// Tries every split of `items` into two sheets that the area allows.
    fn split_two(&mut self, items: &[usize]) -> Option<Vec<Packed>> {
        let n = items.len();
        // The first item always goes to the first sheet: the two sheets are interchangeable.
        for mask in 0..(1u32 << (n - 1)) {
            if self.spent() {
                return None;
            }
            let mask = (mask << 1) | 1;
            let (a, b): (Vec<usize>, Vec<usize>) = (0..n).partition(|&k| mask & (1 << k) != 0);
            let a: Vec<usize> = a.into_iter().map(|k| items[k]).collect();
            let b: Vec<usize> = b.into_iter().map(|k| items[k]).collect();
            if self.area_of(&a) > self.cap || self.area_of(&b) > self.cap {
                continue;
            }
            let Some(sa) = self.pack_one(&a) else {
                continue;
            };
            if b.is_empty() {
                return Some(vec![Packed::new(a, sa, self.fitting)]);
            }
            let Some(sb) = self.pack_one(&b) else {
                continue;
            };
            return Some(vec![
                Packed::new(a, sa, self.fitting),
                Packed::new(b, sb, self.fitting),
            ]);
        }
        None
    }

    /// Index of the least used sheet; the later one on ties.
    fn emptiest(bins: &[Packed]) -> usize {
        let mut min = bins.len() - 1;
        for (i, b) in bins.iter().enumerate() {
            if b.used < bins[min].used {
                min = i;
            }
        }
        min
    }

    /// Moves the emptiest sheet's items into other sheets; true if it emptied the sheet.
    fn eject(&mut self, bins: &mut Vec<Packed>) -> bool {
        let t = Self::emptiest(bins);
        let mut items = bins[t].items.clone();
        items.sort_by_key(|&i| std::cmp::Reverse(self.fitting[i].area()));
        for item in items {
            let mut others: Vec<usize> = (0..bins.len()).filter(|&j| j != t).collect();
            others.sort_by_key(|&j| bins[j].used);
            for j in others {
                if self.spent() {
                    return false;
                }
                if bins[j].used + self.fitting[item].area() > self.cap {
                    continue;
                }
                let mut grown = bins[j].items.clone();
                grown.push(item);
                if let Some(slots) = self.pack_one(&grown) {
                    bins[j] = Packed::new(grown, slots, self.fitting);
                    let k = bins[t].items.iter().position(|&i| i == item).unwrap();
                    let mut left = bins[t].items.clone();
                    let mut left_slots = bins[t].slots.clone();
                    left.remove(k);
                    left_slots.remove(k);
                    bins[t] = Packed::new(left, left_slots, self.fitting);
                    break;
                }
            }
        }
        if bins[t].items.is_empty() {
            bins.remove(t);
            return true;
        }
        false
    }

    /// Repacks two or three sheets into one sheet fewer, trying the groups with the least
    /// area first.
    fn pool(&mut self, bins: &mut Vec<Packed>) -> bool {
        let mut light: Vec<usize> = (0..bins.len()).collect();
        light.sort_by_key(|&j| bins[j].used);
        light.truncate(POOL_FROM);
        for extra in 1..=POOL_SHEETS.min(light.len() - 1) {
            let mut groups: Vec<(u64, Vec<usize>)> = combinations(light.len(), extra + 1)
                .into_iter()
                .map(|c| {
                    let group: Vec<usize> = c.iter().map(|&k| light[k]).collect();
                    (group.iter().map(|&j| bins[j].used).sum(), group)
                })
                .filter(|(used, _)| *used <= self.cap * extra as u64)
                .collect();
            groups.sort_by_key(|(used, _)| *used);
            for (_, mut group) in groups.into_iter().take(COMBOS * self.effort as usize) {
                if self.spent() {
                    return false;
                }
                let pool: Vec<usize> = group.iter().flat_map(|&j| bins[j].items.clone()).collect();
                if let Some(new_bins) = self.pack_into(&pool, extra) {
                    group.sort_unstable();
                    for &j in group.iter().rev() {
                        bins.remove(j);
                    }
                    bins.extend(new_bins);
                    return true;
                }
            }
        }
        false
    }
}

/// All `k`-subsets of `0..n`, in lexicographic order.
fn combinations(n: usize, k: usize) -> Vec<Vec<usize>> {
    if k > n {
        return vec![];
    }
    let mut out = Vec::new();
    let mut c: Vec<usize> = (0..k).collect();
    loop {
        out.push(c.clone());
        // The rightmost position that can still move right.
        let mut i = k;
        while i > 0 && c[i - 1] == i - 1 + n - k {
            i -= 1;
        }
        if i == 0 {
            return out;
        }
        c[i - 1] += 1;
        for j in i..k {
            c[j] = c[j - 1] + 1;
        }
    }
}

/// Tries to bring `bins` down towards the area lower bound.
pub(crate) fn improve(
    bins: Vec<Packed>,
    fitting: &[Inflated],
    area: (u32, u32),
    rng: u32,
    effort: u32,
) -> Vec<Packed> {
    let cap = area.0 as u64 * area.1 as u64;
    let total: u64 = fitting.iter().map(|i| i.area()).sum();
    let bound = total.div_ceil(cap) as usize;
    let mut search = Search {
        fitting,
        area,
        cap,
        rng: rng ^ 0x85EB_CA6B,
        effort,
        work: 0,
        limit: WORK * effort as u64,
    };
    if search.rng == 0 {
        search.rng = 0x85EB_CA6B;
    }
    // Every step either removes a sheet or, when ejection moves only some items, leaves
    // the emptiest sheet emptier: the rank never gets worse.
    let mut bins = bins;
    while bins.len() > bound && !search.spent() {
        if !(search.eject(&mut bins) || search.pool(&mut bins)) {
            break;
        }
    }
    bins
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn combinations_are_complete() {
        assert_eq!(
            combinations(4, 2),
            vec![
                vec![0, 1],
                vec![0, 2],
                vec![0, 3],
                vec![1, 2],
                vec![1, 3],
                vec![2, 3]
            ]
        );
        assert_eq!(combinations(3, 3), vec![vec![0, 1, 2]]);
        assert!(combinations(2, 3).is_empty());
    }
}
