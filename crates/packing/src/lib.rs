//! Sheet layout engine: packs rectangular photos onto as few sheets as possible.
//! All lengths are in tenths of a millimetre.

mod maxrects;

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
pub struct PackOutput {
    pub sheets: Vec<Sheet>,
    pub unplaced: Vec<String>,
}

const SEED: u32 = 0x9E37_79B9;
const SHUFFLES: usize = 200;
const HEURISTICS: [Heuristic; 3] = [
    Heuristic::BestShortSide,
    Heuristic::BestArea,
    Heuristic::BottomLeft,
];

/// An item inflated by the gap, so spacing exists only between photos.
#[derive(Clone, Copy)]
struct Inflated {
    index: usize,
    w: u32,
    h: u32,
}

impl Inflated {
    fn area(&self) -> u64 {
        self.w as u64 * self.h as u64
    }
}

struct Attempt {
    /// (sheet index, x, y, rotated) per item index.
    slots: Vec<(usize, u32, u32, bool)>,
    sheets: usize,
    last_area: u64,
    /// Tie-break: the more compact the last sheet, the better.
    last_extent: u64,
}

fn xorshift(state: &mut u32) -> u32 {
    *state ^= *state << 13;
    *state ^= *state >> 17;
    *state ^= *state << 5;
    *state
}

fn run(order: &[Inflated], area: (u32, u32), heuristic: Heuristic, n: usize) -> Attempt {
    let mut bins: Vec<Bin> = Vec::new();
    let mut slots = vec![(0, 0, 0, false); n];
    for it in order {
        let mut placed = None;
        for (si, bin) in bins.iter_mut().enumerate() {
            if let Some(s) = bin.insert(it.w, it.h, heuristic) {
                placed = Some((si, s));
                break;
            }
        }
        if placed.is_none() {
            // Every item reaching here fits an empty sheet (checked by the caller).
            let mut bin = Bin::new(area.0, area.1);
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
    }
}

pub fn pack(input: &PackInput) -> PackOutput {
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
    for (index, it) in input.items.iter().enumerate() {
        let w = it.w.saturating_add(input.gap);
        let h = it.h.saturating_add(input.gap);
        if (w <= area_w && h <= area_h) || (h <= area_w && w <= area_h) {
            fitting.push(Inflated { index, w, h });
        } else {
            unplaced.push(it.id.clone());
        }
    }
    if fitting.is_empty() {
        return PackOutput {
            sheets: vec![],
            unplaced,
        };
    }

    let mut orders: Vec<Vec<Inflated>> = Vec::new();
    let mut by_area = fitting.clone();
    by_area.sort_by_key(|i| std::cmp::Reverse(i.area()));
    orders.push(by_area);
    let mut by_long = fitting.clone();
    by_long.sort_by_key(|i| std::cmp::Reverse(i.w.max(i.h)));
    orders.push(by_long);
    let mut by_h = fitting.clone();
    by_h.sort_by_key(|i| std::cmp::Reverse(i.h));
    orders.push(by_h);
    let mut by_w = fitting.clone();
    by_w.sort_by_key(|i| std::cmp::Reverse(i.w));
    orders.push(by_w);

    let mut rng = SEED;
    let mut shuffled = fitting.clone();
    for _ in 0..SHUFFLES {
        for i in (1..shuffled.len()).rev() {
            let j = (xorshift(&mut rng) as usize) % (i + 1);
            shuffled.swap(i, j);
        }
        orders.push(shuffled.clone());
    }

    // Fewest sheets first, then the least area used on the last sheet,
    // then the most compact last sheet; the first best wins.
    let mut best: Option<Attempt> = None;
    for order in &orders {
        for &heuristic in &HEURISTICS {
            let a = run(order, (area_w, area_h), heuristic, input.items.len());
            if best.as_ref().is_none_or(|b| {
                (a.sheets, a.last_area, a.last_extent) < (b.sheets, b.last_area, b.last_extent)
            }) {
                best = Some(a);
            }
        }
    }
    let best = best.expect("at least one attempt was made");

    let mut sheets: Vec<Sheet> = (0..best.sheets)
        .map(|_| Sheet { placements: vec![] })
        .collect();
    for f in &fitting {
        let (si, x, y, rotated) = best.slots[f.index];
        sheets[si].placements.push(Placement {
            id: input.items[f.index].id.clone(),
            x: x + input.margin,
            y: y + input.margin,
            rotated,
        });
    }
    PackOutput { sheets, unplaced }
}

/// JSON entry point for the web app.
#[cfg(feature = "wasm")]
#[wasm_bindgen::prelude::wasm_bindgen]
pub fn pack_json(input: &str) -> Result<String, wasm_bindgen::JsError> {
    let parsed: PackInput = serde_json::from_str(input)?;
    Ok(serde_json::to_string(&pack(&parsed))?)
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
            let inp = input(items.clone());
            let out = pack(&inp);
            let mut count = out.unplaced.len();
            for sheet in &out.sheets {
                let rects: Vec<(u32, u32, u32, u32)> = sheet
                    .placements
                    .iter()
                    .map(|p| {
                        let it = items.iter().find(|i| i.id == p.id).unwrap();
                        let (w, h) = if p.rotated {
                            (it.h, it.w)
                        } else {
                            (it.w, it.h)
                        };
                        (p.x, p.y, w, h)
                    })
                    .collect();
                count += rects.len();
                for &(x, y, w, h) in &rects {
                    assert!(x >= MARGIN && y >= MARGIN);
                    assert!(x + w <= W - MARGIN && y + h <= H - MARGIN);
                }
                for (i, a) in rects.iter().enumerate() {
                    for b in &rects[i + 1..] {
                        let apart_x = a.0 + a.2 + GAP <= b.0 || b.0 + b.2 + GAP <= a.0;
                        let apart_y = a.1 + a.3 + GAP <= b.1 || b.1 + b.3 + GAP <= a.1;
                        assert!(apart_x || apart_y, "overlap: {a:?} {b:?}");
                    }
                }
            }
            assert_eq!(count, items.len());
        }
    }
}
