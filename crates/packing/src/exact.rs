//! Exact single-sheet feasibility for a handful of rectangles.
//!
//! Some packing exists if and only if one exists where every rectangle is pushed up and
//! left as far as it goes; then each corner coordinate is a sum of sides of other
//! rectangles ("normal patterns"). Those sums cut the sheet into a grid of cells. The
//! search repeatedly takes the first uncovered cell, in reading order, and either puts a
//! rectangle's corner there or leaves the cell empty. Identical rectangles are one
//! branch, and the search stops when the uncovered area cannot hold what is left.
//! It is bounded by a node budget.

pub enum Fit {
    /// Top-left corner and rotation for each rectangle, in input order.
    Yes(Vec<(u32, u32, bool)>),
    /// Proven impossible.
    No,
    /// The budget ran out first.
    Unknown,
}

/// Sizes this varied make the grid too fine to search; the caller falls back on heuristics.
const MAX_CELLS: usize = 1 << 14;

/// Sums of any choice of 0, w or h per rectangle, up to `limit`, sorted.
fn sums(items: &[(u32, u32)], limit: u32) -> Vec<u32> {
    let mut seen = vec![false; limit as usize + 1];
    seen[0] = true;
    for &(w, h) in items {
        for s in (0..=limit).rev() {
            if !seen[s as usize] {
                continue;
            }
            for d in [w, h] {
                if let Some(t) = s.checked_add(d) {
                    if t <= limit {
                        seen[t as usize] = true;
                    }
                }
            }
        }
    }
    (0..=limit).filter(|&s| seen[s as usize]).collect()
}

/// Identical rectangles (up to rotation), still to place.
struct Kind {
    w: u32,
    h: u32,
    left: usize,
    /// Input indices of the rectangles of this kind.
    members: Vec<usize>,
}

struct Search<'a> {
    kinds: Vec<Kind>,
    xs: Vec<u32>,
    ys: Vec<u32>,
    area: (u32, u32),
    /// Row-major; true once a rectangle or the "left empty" choice covers the cell.
    covered: Vec<bool>,
    /// Area of the cells not covered yet.
    free: u64,
    /// Area of the rectangles not placed yet.
    needed: u64,
    /// (kind, x, y, rotated) for each rectangle placed so far.
    placed: Vec<(usize, u32, u32, bool)>,
    budget: &'a mut u64,
}

impl Search<'_> {
    fn cell_w(&self, i: usize) -> u64 {
        (self.xs.get(i + 1).copied().unwrap_or(self.area.0) - self.xs[i]) as u64
    }

    fn cell_h(&self, j: usize) -> u64 {
        (self.ys.get(j + 1).copied().unwrap_or(self.area.1) - self.ys[j]) as u64
    }

    /// Columns i..ci and rows j..cj a w x h rectangle with its corner at cell (i, j)
    /// would cover, if they are all free.
    /// Charges the budget for each cell it reads.
    fn span(&mut self, i: usize, j: usize, w: u32, h: u32) -> Option<(usize, usize)> {
        let (x, y) = (self.xs[i], self.ys[j]);
        if x + w > self.area.0 || y + h > self.area.1 {
            return None;
        }
        let mut ci = i;
        while ci < self.xs.len() && self.xs[ci] < x + w {
            ci += 1;
        }
        let mut cj = j;
        while cj < self.ys.len() && self.ys[cj] < y + h {
            cj += 1;
        }
        self.charge((ci - i + cj - j) as u64);
        let nx = self.xs.len();
        for row in j..cj {
            self.charge((ci - i) as u64);
            if self.covered[row * nx + i..row * nx + ci].iter().any(|&c| c) {
                return None;
            }
        }
        Some((ci, cj))
    }

    fn charge(&mut self, units: u64) {
        *self.budget = self.budget.saturating_sub(units);
    }

    /// In a packing pushed up as far as it goes, each rectangle touches the top edge or
    /// the bottom of a rectangle above it, which reading order has already placed.
    fn rests_on_top(&self, i: usize, j: usize, w: u32) -> bool {
        let (x, y) = (self.xs[i], self.ys[j]);
        y == 0
            || self.placed.iter().any(|&(k, px, py, rot)| {
                let kind = &self.kinds[k];
                let (pw, ph) = if rot {
                    (kind.h, kind.w)
                } else {
                    (kind.w, kind.h)
                };
                py + ph == y && px < x + w && x < px + pw
            })
    }

    /// Likewise each rectangle touches the left edge or the right side of a rectangle
    /// beside it. That neighbour may come later in reading order, but its top lies above
    /// the rectangle's bottom: once the search has moved past that row, it is too late.
    fn stranded(&self, row_y: u32) -> bool {
        let side = |&(k, x, y, rot): &(usize, u32, u32, bool)| {
            let kind = &self.kinds[k];
            let (w, h) = if rot {
                (kind.h, kind.w)
            } else {
                (kind.w, kind.h)
            };
            (x, y, w, h)
        };
        self.placed.iter().map(side).any(|(x, y, _, h)| {
            x > 0
                && y + h <= row_y
                && !self
                    .placed
                    .iter()
                    .map(side)
                    .any(|(qx, qy, qw, qh)| qx + qw == x && qy < y + h && y < qy + qh)
        })
    }

    fn mark(&mut self, i: usize, j: usize, ci: usize, cj: usize, on: bool) {
        self.charge(((ci - i) * (cj - j)) as u64);
        let nx = self.xs.len();
        let mut area = 0;
        for row in j..cj {
            for col in i..ci {
                self.covered[row * nx + col] = on;
                area += self.cell_w(col) * self.cell_h(row);
            }
        }
        if on {
            self.free -= area;
        } else {
            self.free += area;
        }
    }

    /// Some(true): all placed; Some(false): no way from here; None: budget exhausted.
    /// Empty cells are a loop, not recursion, so the depth stays the number of rectangles.
    fn dfs(&mut self, mut pos: usize) -> Option<bool> {
        let mut emptied = Vec::new();
        let result = loop {
            if self.needed == 0 {
                return Some(true);
            }
            if self.needed > self.free {
                break Some(false);
            }
            while pos < self.covered.len() && self.covered[pos] {
                pos += 1;
            }
            if pos == self.covered.len() {
                break Some(false);
            }
            let nx = self.xs.len();
            let (i, j) = (pos % nx, pos / nx);
            // The neighbour checks below read every placed pair.
            let placed = self.placed.len() as u64;
            self.charge(1 + placed * placed);
            if *self.budget == 0 {
                return None;
            }
            if self.stranded(self.ys[j]) {
                break Some(false);
            }
            for k in 0..self.kinds.len() {
                if self.kinds[k].left == 0 {
                    continue;
                }
                let (w0, h0) = (self.kinds[k].w, self.kinds[k].h);
                let turns: &[bool] = if w0 == h0 { &[false] } else { &[false, true] };
                for &rot in turns {
                    let (w, h) = if rot { (h0, w0) } else { (w0, h0) };
                    if !self.rests_on_top(i, j, w) {
                        continue;
                    }
                    let Some((ci, cj)) = self.span(i, j, w, h) else {
                        continue;
                    };
                    if *self.budget == 0 {
                        return None;
                    }
                    self.mark(i, j, ci, cj, true);
                    self.kinds[k].left -= 1;
                    self.needed -= w as u64 * h as u64;
                    self.placed.push((k, self.xs[i], self.ys[j], rot));
                    let r = self.dfs(pos + 1);
                    if r != Some(false) {
                        return r;
                    }
                    self.placed.pop();
                    self.needed += w as u64 * h as u64;
                    self.kinds[k].left += 1;
                    self.mark(i, j, ci, cj, false);
                }
            }
            // Or nothing has its corner here: the cell stays empty.
            if *self.budget == 0 {
                return None;
            }
            self.mark(i, j, i + 1, j + 1, true);
            emptied.push((i, j));
            pos += 1;
        };
        for &(i, j) in emptied.iter().rev() {
            self.mark(i, j, i + 1, j + 1, false);
        }
        result
    }
}

/// Decides whether all `items` fit one `area`, spending at most `budget` steps: one
/// per subset-sum step of the setup, per search node and per grid cell read or written.
/// A run that spends it all answers `Unknown` and leaves `budget` at zero.
pub fn fit(items: &[(u32, u32)], area: (u32, u32), budget: &mut u64) -> Fit {
    let needed: u64 = items.iter().map(|&(w, h)| w as u64 * h as u64).sum();
    let cap = area.0 as u64 * area.1 as u64;
    if needed > cap {
        return Fit::No;
    }
    let fits_alone =
        |&(w, h): &(u32, u32)| (w <= area.0 && h <= area.1) || (h <= area.0 && w <= area.1);
    if !items.iter().all(fits_alone) {
        return Fit::No;
    }
    if items.is_empty() {
        return Fit::Yes(vec![]);
    }

    let mut kinds: Vec<Kind> = Vec::new();
    for (i, &(w, h)) in items.iter().enumerate() {
        let shape = (w.min(h), w.max(h));
        match kinds
            .iter_mut()
            .find(|k| (k.w.min(k.h), k.w.max(k.h)) == shape)
        {
            Some(k) => {
                k.left += 1;
                k.members.push(i);
            }
            None => kinds.push(Kind {
                w,
                h,
                left: 1,
                members: vec![i],
            }),
        }
    }
    // Biggest first.
    kinds.sort_by_key(|k| std::cmp::Reverse((k.w as u64 * k.h as u64, k.w.max(k.h))));

    // The subset sums walk each length once per rectangle.
    let setup = (area.0 as u64 + area.1 as u64 + 2) * items.len() as u64;
    if *budget < setup {
        *budget = 0;
        return Fit::Unknown;
    }
    *budget -= setup;
    // No corner lies where even the narrowest rectangle would stick out.
    let min_side = items.iter().map(|&(w, h)| w.min(h)).min().unwrap_or(0);
    let xs: Vec<u32> = sums(items, area.0)
        .into_iter()
        .filter(|&s| s + min_side <= area.0)
        .collect();
    let ys: Vec<u32> = sums(items, area.1)
        .into_iter()
        .filter(|&s| s + min_side <= area.1)
        .collect();
    let cells = xs.len() * ys.len();
    if cells > MAX_CELLS || *budget < cells as u64 {
        return Fit::Unknown;
    }
    *budget -= cells as u64;
    let mut search = Search {
        kinds,
        xs,
        ys,
        area,
        covered: vec![false; cells],
        free: cap,
        needed,
        placed: Vec::with_capacity(items.len()),
        budget,
    };
    match search.dfs(0) {
        Some(true) => {
            let mut out = vec![(0, 0, false); items.len()];
            let mut next = vec![0; search.kinds.len()];
            for &(k, x, y, rot) in &search.placed {
                let kind = &search.kinds[k];
                let i = kind.members[next[k]];
                next[k] += 1;
                // `rot` is relative to the kind's first member; match this member's sides.
                let (w, h) = if rot {
                    (kind.h, kind.w)
                } else {
                    (kind.w, kind.h)
                };
                out[i] = (x, y, items[i] != (w, h));
            }
            Fit::Yes(out)
        }
        Some(false) => Fit::No,
        None => Fit::Unknown,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn yes(items: &[(u32, u32)], area: (u32, u32)) -> bool {
        let mut budget = u64::MAX;
        match fit(items, area, &mut budget) {
            Fit::Yes(slots) => {
                for (i, &(x, y, r)) in slots.iter().enumerate() {
                    let (w, h) = if r {
                        (items[i].1, items[i].0)
                    } else {
                        items[i]
                    };
                    assert!(x + w <= area.0 && y + h <= area.1);
                    for (j, &(x2, y2, r2)) in slots.iter().enumerate().skip(i + 1) {
                        let (w2, h2) = if r2 {
                            (items[j].1, items[j].0)
                        } else {
                            items[j]
                        };
                        assert!(x + w <= x2 || x2 + w2 <= x || y + h <= y2 || y2 + h2 <= y);
                    }
                }
                true
            }
            Fit::No => false,
            Fit::Unknown => panic!("unbounded budget"),
        }
    }

    #[test]
    fn perfect_tiling_fits() {
        assert!(yes(&[(2, 3), (2, 3), (3, 2), (2, 3)], (4, 6)));
    }

    #[test]
    fn needs_a_turn() {
        assert!(yes(&[(4, 2), (2, 4)], (4, 4)));
    }

    #[test]
    fn pinwheel_fits() {
        // Four 2x1 bars around a 1x1 hole fill a 3x3 square only as a pinwheel.
        assert!(yes(&[(2, 1), (2, 1), (2, 1), (2, 1), (1, 1)], (3, 3)));
    }

    #[test]
    fn area_is_not_enough() {
        // A 3x3 leaves only a 1-wide strip of a 4x4.
        assert!(!yes(&[(3, 3), (2, 2)], (4, 4)));
        assert!(yes(
            &[
                (3, 3),
                (1, 1),
                (1, 1),
                (1, 1),
                (1, 1),
                (1, 1),
                (1, 1),
                (1, 1)
            ],
            (4, 4)
        ));
    }

    #[test]
    fn budget_runs_out() {
        let mut budget = 1;
        let items = [(2, 1), (2, 1), (2, 1), (2, 1), (1, 1)];
        assert!(matches!(fit(&items, (3, 3), &mut budget), Fit::Unknown));
    }
}
