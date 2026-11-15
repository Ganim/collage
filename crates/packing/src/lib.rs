//! Sheet layout engine: packs rectangular photos onto as few sheets as possible.
//! All lengths are in tenths of a millimetre.
//!
//! Two phases: a greedy MaxRects pass over many item orders, then, while the result is
//! above the area lower bound, a search that tries to empty a sheet (see `improve`).

mod exact;
mod improve;
mod maxrects;
#[cfg(test)]
mod regression;

use maxrects::{Bin, Heuristic};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
pub struct Item {
    pub id: String,
    pub w: u32,
    pub h: u32,
}

#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackInput {
    pub items: Vec<Item>,
    pub sheet_w: u32,
    pub sheet_h: u32,
    pub margin: u32,
    pub gap: u32,
    /// Seed for the shuffled orders; the same seed gives the same layout.
    #[serde(default)]
    pub seed: Option<u32>,
    /// Multiplies the work of both phases; 1 when absent.
    #[serde(default)]
    pub effort: Option<u32>,
}

/// Position of the photo's top-left corner, measured from the sheet corner.
#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
pub struct Placement {
    pub id: String,
    pub x: u32,
    pub y: u32,
    pub rotated: bool,
}

#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
pub struct Sheet {
    pub placements: Vec<Placement>,
}

#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackOutput {
    pub sheets: Vec<Sheet>,
    pub unplaced: Vec<String>,
    /// Area used on the last sheet, items inflated by the gap; ranks layouts of equal length.
    pub last_area: u64,
    /// Bounding-box area of the last sheet's items; the final tie-break.
    pub last_extent: u64,
    /// Fewest sheets the items' area allows; no layout uses fewer.
    pub lower_bound: usize,
}

const SEED: u32 = 0x9E37_79B9;
const SHUFFLES: usize = 200;
/// Highest effort accepted; more is clamped.
const MAX_EFFORT: u32 = 64;
pub(crate) const HEURISTICS: [Heuristic; 3] = [
    Heuristic::BestShortSide,
    Heuristic::BestArea,
    Heuristic::BottomLeft,
];

/// An item inflated by the gap, so spacing exists only between photos.
/// `index` is the item's position in the list of items that fit a sheet.
#[derive(Clone, Copy)]
pub(crate) struct Inflated {
    pub index: usize,
    pub w: u32,
    pub h: u32,
}

impl Inflated {
    pub fn area(&self) -> u64 {
        self.w as u64 * self.h as u64
    }
}

/// Top-left corner and whether the item is turned, in the area grown by the gap.
pub(crate) type Slot = (u32, u32, bool);

/// One sheet: positions into the fitting items, with a slot (x, y, rotated) for each.
#[derive(Clone)]
pub(crate) struct Packed {
    pub items: Vec<usize>,
    pub slots: Vec<Slot>,
    pub used: u64,
    pub extent: u64,
}

impl Packed {
    pub fn new(items: Vec<usize>, slots: Vec<Slot>, fitting: &[Inflated]) -> Packed {
        let mut used = 0;
        let (mut max_x, mut max_y) = (0u32, 0u32);
        for (&i, &(x, y, rotated)) in items.iter().zip(&slots) {
            let it = fitting[i];
            used += it.area();
            let (w, h) = if rotated { (it.h, it.w) } else { (it.w, it.h) };
            max_x = max_x.max(x + w);
            max_y = max_y.max(y + h);
        }
        Packed {
            items,
            slots,
            used,
            extent: max_x as u64 * max_y as u64,
        }
    }
}

/// Fewest sheets first, then the least area used on the last sheet,
/// then the most compact last sheet.
pub(crate) fn rank(bins: &[Packed]) -> (usize, u64, u64) {
    (
        bins.len(),
        bins.last().map_or(0, |b| b.used),
        bins.last().map_or(0, |b| b.extent),
    )
}

struct Attempt {
    /// (sheet index, x, y, rotated) per fitting position.
    slots: Vec<(usize, u32, u32, bool)>,
    sheets: usize,
    last_area: u64,
    /// Tie-break: the more compact the last sheet, the better.
    last_extent: u64,
    /// MaxRects inserts tried, in work units.
    work: u64,
}

pub(crate) fn xorshift(state: &mut u32) -> u32 {
    *state ^= *state << 13;
    *state ^= *state >> 17;
    *state ^= *state << 5;
    *state
}

/// Fisher-Yates shuffle driven by `xorshift`.
pub(crate) fn shuffle<T>(list: &mut [T], rng: &mut u32) {
    for i in (1..list.len()).rev() {
        let j = (xorshift(rng) as usize) % (i + 1);
        list.swap(i, j);
    }
}

/// The four sorted orders tried before any shuffle.
pub(crate) fn sorted_orders(items: &[Inflated]) -> Vec<Vec<Inflated>> {
    let mut by_area = items.to_vec();
    by_area.sort_by_key(|i| std::cmp::Reverse(i.area()));
    let mut by_long = items.to_vec();
    by_long.sort_by_key(|i| std::cmp::Reverse(i.w.max(i.h)));
    let mut by_h = items.to_vec();
    by_h.sort_by_key(|i| std::cmp::Reverse(i.h));
    let mut by_w = items.to_vec();
    by_w.sort_by_key(|i| std::cmp::Reverse(i.w));
    vec![by_area, by_long, by_h, by_w]
}

fn run(order: &[Inflated], area: (u32, u32), heuristic: Heuristic, n: usize) -> Attempt {
    let mut bins: Vec<Bin> = Vec::new();
    let mut slots = vec![(0, 0, 0, false); n];
    let mut work = 0;
    for it in order {
        let mut placed = None;
        for (si, bin) in bins.iter_mut().enumerate() {
            work += 1;
            if let Some(s) = bin.insert(it.w, it.h, heuristic) {
                placed = Some((si, s));
                break;
            }
        }
        if placed.is_none() {
            // Every item reaching here fits an empty sheet (checked by the caller).
            let mut bin = Bin::new(area.0, area.1);
            work += 1;
            placed = bin.insert(it.w, it.h, heuristic).map(|s| (bins.len(), s));
            bins.push(bin);
        }
        if let Some((si, s)) = placed {
            slots[it.index] = (si, s.x, s.y, s.rotated);
        }
    }
    Attempt {
        slots,
        sheets: bins.len(),
        last_area: bins.last().map_or(0, |b| b.used_area),
        last_extent: bins.last().map_or(0, |b| b.extent_area()),
        work,
    }
}

/// Phase one: first-fit MaxRects with every heuristic over the sorted orders, `SHUFFLES`
/// shuffled ones (the first release, never cut short), then up to `extra` more shuffles
/// while their work stays under `extra_work`. The first best attempt wins. Returns the
/// layout and the work spent on the extra shuffles.
fn greedy(
    fitting: &[Inflated],
    area: (u32, u32),
    rng: &mut u32,
    extra: usize,
    extra_work: u64,
) -> (Vec<Packed>, u64) {
    let mut best: Option<Attempt> = None;
    let mut spent = 0;
    let try_order = |order: &[Inflated], best: &mut Option<Attempt>| {
        let mut work = 0;
        for &heuristic in &HEURISTICS {
            let a = run(order, area, heuristic, fitting.len());
            work += a.work;
            if best.as_ref().is_none_or(|b| {
                (a.sheets, a.last_area, a.last_extent) < (b.sheets, b.last_area, b.last_extent)
            }) {
                *best = Some(a);
            }
        }
        work
    };
    for order in sorted_orders(fitting) {
        try_order(&order, &mut best);
    }
    let mut shuffled = fitting.to_vec();
    for k in 0..SHUFFLES + extra {
        if k >= SHUFFLES && spent >= extra_work {
            break;
        }
        shuffle(&mut shuffled, rng);
        let work = try_order(&shuffled, &mut best);
        if k >= SHUFFLES {
            spent += work;
        }
    }
    let best = best.expect("at least one attempt was made");

    let mut items: Vec<Vec<usize>> = vec![vec![]; best.sheets];
    let mut slots: Vec<Vec<Slot>> = vec![vec![]; best.sheets];
    for (i, &(si, x, y, rotated)) in best.slots.iter().enumerate() {
        items[si].push(i);
        slots[si].push((x, y, rotated));
    }
    let bins = items
        .into_iter()
        .zip(slots)
        .map(|(items, slots)| Packed::new(items, slots, fitting))
        .collect();
    (bins, spent)
}

/// Puts the least used sheet last, which only ever improves the rank.
fn emptiest_last(bins: &mut Vec<Packed>) {
    if let Some(last) = bins.len().checked_sub(1) {
        let mut min = last;
        for (i, b) in bins.iter().enumerate() {
            if b.used < bins[min].used {
                min = i;
            }
        }
        if min != last {
            let b = bins.remove(min);
            bins.push(b);
        }
    }
}

/// Sheets used by the first release: phase one only, default seed and effort.
#[cfg(test)]
pub(crate) fn pack_greedy_only(input: &PackInput) -> usize {
    let (area, fitting, _, _) = prepare(input);
    if fitting.is_empty() {
        return 0;
    }
    let mut rng = SEED;
    greedy(&fitting, area, &mut rng, 0, 0).0.len()
}

/// The usable area grown by the gap, the items that fit it (inflated) with their input
/// positions, and the ids of those that do not.
fn prepare(input: &PackInput) -> ((u32, u32), Vec<Inflated>, Vec<usize>, Vec<String>) {
    // Working on area + gap with items + gap makes spacing exist only between photos.
    let area_w = input
        .sheet_w
        .saturating_sub(2 * input.margin)
        .saturating_add(input.gap);
    let area_h = input
        .sheet_h
        .saturating_sub(2 * input.margin)
        .saturating_add(input.gap);

    let mut unplaced = Vec::new();
    let mut fitting: Vec<Inflated> = Vec::new();
    let mut origin = Vec::new();
    for (index, it) in input.items.iter().enumerate() {
        let w = it.w.saturating_add(input.gap);
        let h = it.h.saturating_add(input.gap);
        if (w <= area_w && h <= area_h) || (h <= area_w && w <= area_h) {
            fitting.push(Inflated {
                index: fitting.len(),
                w,
                h,
            });
            origin.push(index);
        } else {
            unplaced.push(it.id.clone());
        }
    }
    ((area_w, area_h), fitting, origin, unplaced)
}

pub fn pack(input: &PackInput) -> PackOutput {
    let (area, fitting, origin, unplaced) = prepare(input);
    if fitting.is_empty() {
        return PackOutput {
            sheets: vec![],
            unplaced,
            last_area: 0,
            last_extent: 0,
            lower_bound: 0,
        };
    }
    let effort = input.effort.unwrap_or(1).clamp(1, MAX_EFFORT);
    let mut rng = match input.seed {
        Some(seed) if seed != SEED => seed ^ SEED,
        _ => SEED,
    };
    // One budget for the effort: phase one's extra shuffles may take up to half of it,
    // phase two gets the rest. The first release's orders always run, uncharged.
    let budget = improve::WORK * effort as u64;
    let extra = SHUFFLES * (effort as usize - 1);
    let (mut bins, spent) = greedy(&fitting, area, &mut rng, extra, budget / 2);
    emptiest_last(&mut bins);

    let mut improved = improve::improve(
        bins.clone(),
        &fitting,
        area,
        rng,
        effort,
        budget - spent.min(budget),
    );
    emptiest_last(&mut improved);
    if rank(&improved) < rank(&bins) {
        bins = improved;
    }

    let (_, last_area, last_extent) = rank(&bins);
    let lower_bound = improve::lower_bound(&fitting, area);
    let sheets = bins
        .into_iter()
        .map(|b| {
            let mut placements: Vec<(usize, Placement)> = b
                .items
                .iter()
                .zip(&b.slots)
                .map(|(&i, &(x, y, rotated))| {
                    (
                        i,
                        Placement {
                            id: input.items[origin[i]].id.clone(),
                            x: x + input.margin,
                            y: y + input.margin,
                            rotated,
                        },
                    )
                })
                .collect();
            placements.sort_by_key(|(i, _)| *i);
            Sheet {
                placements: placements.into_iter().map(|(_, p)| p).collect(),
            }
        })
        .collect();
    PackOutput {
        sheets,
        unplaced,
        last_area,
        last_extent,
        lower_bound,
    }
}

/// JSON entry point for the web app.
#[cfg(feature = "wasm")]
#[wasm_bindgen::prelude::wasm_bindgen]
pub fn pack_json(input: &str) -> Result<String, wasm_bindgen::JsError> {
    let parsed: PackInput = serde_json::from_str(input)?;
    Ok(serde_json::to_string(&pack(&parsed))?)
}

/// Asserts that `input` packs into a valid layout: every item once, inside the margins,
/// at least the gap apart. Returns the layout; `sheets`, when given, checks its length.
#[cfg(test)]
pub(crate) fn check_layout(input: &PackInput, sheets: Option<usize>) -> PackOutput {
    let out = pack(input);
    if let Some(n) = sheets {
        assert_eq!(out.sheets.len(), n);
    }
    let mut seen: Vec<&str> = out.unplaced.iter().map(String::as_str).collect();
    for sheet in &out.sheets {
        let rects: Vec<(u32, u32, u32, u32)> = sheet
            .placements
            .iter()
            .map(|p| {
                seen.push(&p.id);
                let it = input.items.iter().find(|i| i.id == p.id).unwrap();
                let (w, h) = if p.rotated {
                    (it.h, it.w)
                } else {
                    (it.w, it.h)
                };
                (p.x, p.y, w, h)
            })
            .collect();
        for &(x, y, w, h) in &rects {
            assert!(x >= input.margin && y >= input.margin);
            assert!(x + w <= input.sheet_w - input.margin && y + h <= input.sheet_h - input.margin);
        }
        for (i, a) in rects.iter().enumerate() {
            for b in &rects[i + 1..] {
                let apart_x = a.0 + a.2 + input.gap <= b.0 || b.0 + b.2 + input.gap <= a.0;
                let apart_y = a.1 + a.3 + input.gap <= b.1 || b.1 + b.3 + input.gap <= a.1;
                assert!(apart_x || apart_y, "overlap: {a:?} {b:?}");
            }
        }
    }
    seen.sort_unstable();
    let mut ids: Vec<&str> = input.items.iter().map(|i| i.id.as_str()).collect();
    ids.sort_unstable();
    assert_eq!(seen, ids);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    const W: u32 = 2100;
    const H: u32 = 2970;
    const MARGIN: u32 = 50;
    const GAP: u32 = 30;

    fn item(id: &str, w: u32, h: u32) -> Item {
        Item {
            id: id.to_string(),
            w,
            h,
        }
    }

    fn input(items: Vec<Item>) -> PackInput {
        PackInput {
            items,
            sheet_w: W,
            sheet_h: H,
            margin: MARGIN,
            gap: GAP,
            seed: None,
            effort: None,
        }
    }

    #[test]
    fn empty_input_has_no_sheets() {
        let out = pack(&input(vec![]));
        assert_eq!(out.sheets.len(), 0);
        assert!(out.unplaced.is_empty());
    }

    #[test]
    fn two_10x15_share_one_sheet() {
        let out = pack(&input(vec![item("a", 1000, 1500), item("b", 1000, 1500)]));
        assert_eq!(out.sheets.len(), 1);
        assert_eq!(out.sheets[0].placements.len(), 2);
        assert!(out.sheets[0].placements.iter().all(|p| p.rotated));
    }

    #[test]
    fn three_10x15_need_two_sheets() {
        let items = vec![
            item("a", 1000, 1500),
            item("b", 1000, 1500),
            item("c", 1000, 1500),
        ];
        let out = pack(&input(items));
        assert_eq!(out.sheets.len(), 2);
        assert_eq!(out.sheets[0].placements.len(), 2);
        assert_eq!(out.sheets[1].placements.len(), 1);
    }

    #[test]
    fn mixed_month_fits_one_sheet() {
        let items = vec![
            item("a", 1300, 1800),
            item("b", 500, 700),
            item("c", 500, 700),
            item("d", 1000, 1500),
            item("e", 300, 400),
            item("f", 300, 400),
        ];
        let out = pack(&input(items));
        assert_eq!(out.sheets.len(), 1);
        assert!(out.unplaced.is_empty());
    }

    #[test]
    fn exact_usable_area_ignores_gap() {
        let out = pack(&input(vec![item("a", 2000, 2870)]));
        assert_eq!(out.sheets.len(), 1);
        let p = &out.sheets[0].placements[0];
        assert_eq!((p.x, p.y, p.rotated), (MARGIN, MARGIN, false));
    }

    #[test]
    fn rotates_when_only_rotated_fits() {
        let out = pack(&input(vec![item("a", 2800, 1900)]));
        assert_eq!(out.sheets.len(), 1);
        assert!(out.sheets[0].placements[0].rotated);
    }

    #[test]
    fn oversized_goes_to_unplaced() {
        let out = pack(&input(vec![
            item("big", 2100, 3000),
            item("ok", 1000, 1500),
        ]));
        assert_eq!(out.unplaced, vec!["big".to_string()]);
        assert_eq!(out.sheets.len(), 1);
        assert_eq!(out.sheets[0].placements[0].id, "ok");
    }

    #[test]
    fn same_input_same_output() {
        let items = vec![
            item("a", 1300, 1800),
            item("b", 500, 700),
            item("c", 1000, 1500),
        ];
        let inp = input(items);
        assert_eq!(pack(&inp), pack(&inp));
    }

    #[test]
    fn random_inputs_never_overlap() {
        let mut state: u32 = 12345;
        let mut next = move || {
            state ^= state << 13;
            state ^= state >> 17;
            state ^= state << 5;
            state
        };
        for _ in 0..300 {
            let n = 1 + next() % 12;
            let items: Vec<Item> = (0..n)
                .map(|i| item(&format!("i{i}"), 100 + next() % 1900, 100 + next() % 1900))
                .collect();
            check_layout(&input(items), None);
        }
    }

    #[test]
    fn same_seed_same_output_and_seed_changes_the_search() {
        let mut inp = input(
            (0..14)
                .map(|i| {
                    item(
                        &format!("i{i}"),
                        500 + (i * 137) % 1100,
                        700 + (i * 71) % 900,
                    )
                })
                .collect(),
        );
        inp.seed = Some(42);
        inp.effort = Some(3);
        assert_eq!(pack(&inp), pack(&inp));
        check_layout(&inp, None);
    }

    #[test]
    fn effort_and_seed_never_lose_to_the_first_release() {
        let mut state: u32 = 777;
        for round in 0..60 {
            let n = 2 + xorshift(&mut state) % 20;
            let items: Vec<Item> = (0..n)
                .map(|i| {
                    item(
                        &format!("i{i}"),
                        300 + xorshift(&mut state) % 1700,
                        300 + xorshift(&mut state) % 1700,
                    )
                })
                .collect();
            let mut inp = input(items);
            let old = pack_greedy_only(&inp);
            assert!(pack(&inp).sheets.len() <= old);
            inp.effort = Some(4);
            assert!(check_layout(&inp, None).sheets.len() <= old);
            inp.seed = Some(round);
            check_layout(&inp, None);
        }
    }

    #[test]
    fn json_fields_are_optional_and_camel_case() {
        let parsed: PackInput = serde_json::from_str(
            r#"{"items":[{"id":"a","w":1000,"h":1500}],"sheetW":2100,"sheetH":2970,"margin":50,"gap":30}"#,
        )
        .unwrap();
        assert_eq!((parsed.seed, parsed.effort), (None, None));
        let parsed: PackInput = serde_json::from_str(
            r#"{"items":[],"sheetW":2100,"sheetH":2970,"margin":50,"gap":30,"seed":7,"effort":16}"#,
        )
        .unwrap();
        assert_eq!((parsed.seed, parsed.effort), (Some(7), Some(16)));
        let out = serde_json::to_value(pack(&input(vec![item("a", 1000, 1500)]))).unwrap();
        assert_eq!(out["lastArea"], 1030 * 1530);
        assert_eq!(out["lastExtent"], 1030 * 1530);
        assert_eq!(out["lowerBound"], 1);
    }

    #[test]
    fn the_least_used_sheet_goes_last() {
        let mut state: u32 = 99;
        for _ in 0..40 {
            let n = 3 + xorshift(&mut state) % 15;
            let items: Vec<Item> = (0..n)
                .map(|i| {
                    item(
                        &format!("i{i}"),
                        300 + xorshift(&mut state) % 1700,
                        300 + xorshift(&mut state) % 1700,
                    )
                })
                .collect();
            let inp = input(items);
            let out = check_layout(&inp, None);
            let used: Vec<u64> = out
                .sheets
                .iter()
                .map(|s| {
                    s.placements
                        .iter()
                        .map(|p| {
                            let it = inp.items.iter().find(|i| i.id == p.id).unwrap();
                            (it.w + GAP) as u64 * (it.h + GAP) as u64
                        })
                        .sum()
                })
                .collect();
            assert_eq!(out.last_area, *used.last().unwrap());
            assert_eq!(out.last_area, *used.iter().min().unwrap());
        }
    }
}
