//! Compares the packer with an exhaustive optimum on small, realistic instances.

use crate::exact::{self, Fit};
use crate::{check_layout, pack, pack_greedy_only, prepare, Item, PackInput};

/// Common print sizes, in tenths of a millimetre.
const SIZES: [(u32, u32); 6] = [
    (1000, 1500),
    (1300, 1800),
    (1500, 2100),
    (2000, 2500),
    (500, 700),
    (900, 1200),
];
const A4: (u32, u32) = (2100, 2970);
const A3: (u32, u32) = (2970, 4200);
const PAPERS: [(u32, u32); 2] = [A4, A3];
const MARGINS: [u32; 2] = [50, 100];
const GAPS: [u32; 3] = [20, 30, 50];

fn next(state: &mut u32) -> u32 {
    crate::xorshift(state)
}

/// A random instance of 2 to 8 items.
fn instance(state: &mut u32) -> PackInput {
    let n = 2 + next(state) % 7;
    let items = (0..n)
        .map(|i| {
            let (w, h) = SIZES[(next(state) % 6) as usize];
            let (w, h) = if next(state) & 1 == 0 { (w, h) } else { (h, w) };
            Item {
                id: format!("i{i}"),
                w,
                h,
            }
        })
        .collect();
    let (sheet_w, sheet_h) = PAPERS[(next(state) % 2) as usize];
    PackInput {
        items,
        sheet_w,
        sheet_h,
        margin: MARGINS[(next(state) % 2) as usize],
        gap: GAPS[(next(state) % 3) as usize],
        seed: None,
        effort: None,
    }
}

/// The fewest sheets any layout can use, by trying every grouping of the items.
fn optimum(input: &PackInput) -> usize {
    let (area, fitting, _, _) = prepare(input);
    let n = fitting.len();
    let full = (1usize << n) - 1;
    let mut fits = vec![false; full + 1];
    for mask in 1..=full {
        let rects: Vec<(u32, u32)> = (0..n)
            .filter(|k| mask & (1 << k) != 0)
            .map(|k| (fitting[k].w, fitting[k].h))
            .collect();
        // A group fits only if every group with one item fewer fits.
        let subsets_fit = (0..n)
            .filter(|k| mask & (1 << k) != 0 && mask != 1 << k)
            .all(|k| fits[mask & !(1 << k)]);
        fits[mask] = subsets_fit
            && match exact::fit(&rects, area, &mut u64::MAX.clone()) {
                Fit::Yes(_) => true,
                Fit::No => false,
                Fit::Unknown => unreachable!("unbounded budget"),
            };
    }
    // best[mask]: fewest sheets for the items in mask.
    let mut best = vec![usize::MAX; full + 1];
    best[0] = 0;
    for mask in 1..=full {
        let low = mask & mask.wrapping_neg();
        let rest = mask & !low;
        // Every group holding the lowest item.
        let mut sub = rest;
        loop {
            let group = sub | low;
            if fits[group] && best[mask & !group] != usize::MAX {
                best[mask] = best[mask].min(best[mask & !group] + 1);
            }
            if sub == 0 {
                break;
            }
            sub = (sub - 1) & rest;
        }
    }
    best[full]
}

fn lower_bound(input: &PackInput) -> usize {
    let (area, fitting, _, _) = prepare(input);
    let total: u64 = fitting.iter().map(|i| i.area()).sum();
    total.div_ceil(area.0 as u64 * area.1 as u64) as usize
}

fn describe(input: &PackInput) -> String {
    let items: Vec<String> = input
        .items
        .iter()
        .map(|i| format!("({}, {})", i.w, i.h))
        .collect();
    format!(
        "sheet {}x{}, margin {}, gap {}, items [{}]",
        input.sheet_w,
        input.sheet_h,
        input.margin,
        input.gap,
        items.join(", ")
    )
}

fn fixture(sheet: (u32, u32), margin: u32, gap: u32, items: &[(u32, u32)]) -> PackInput {
    PackInput {
        items: items
            .iter()
            .enumerate()
            .map(|(i, &(w, h))| Item {
                id: format!("i{i}"),
                w,
                h,
            })
            .collect(),
        sheet_w: sheet.0,
        sheet_h: sheet.1,
        margin,
        gap,
        seed: None,
        effort: None,
    }
}

/// Instances where the first release used more sheets than needed, found by
/// `search_for_fixtures`: (paper, margin, gap, items, old sheets, optimal sheets).
#[allow(clippy::type_complexity)]
const FIXTURES: &[((u32, u32), u32, u32, &[(u32, u32)], usize, usize)] = &[
    // Four 9x12 cm on A4 with 5 mm spacing: a 2x2 grid only with all four turned.
    (
        A4,
        50,
        50,
        &[(1200, 900), (1200, 900), (1200, 900), (1200, 900)],
        2,
        1,
    ),
    (
        A3,
        100,
        20,
        &[(1300, 1800), (1300, 1800), (1500, 1000), (1500, 2100)],
        2,
        1,
    ),
    (
        A4,
        50,
        20,
        &[
            (900, 1200),
            (1500, 1000),
            (900, 1200),
            (2100, 1500),
            (900, 1200),
        ],
        3,
        2,
    ),
    (
        A4,
        100,
        30,
        &[
            (2100, 1500),
            (1200, 900),
            (900, 1200),
            (900, 1200),
            (900, 1200),
        ],
        3,
        2,
    ),
    (
        A4,
        50,
        50,
        &[
            (1200, 900),
            (2000, 2500),
            (1000, 1500),
            (2500, 2000),
            (2000, 2500),
            (2100, 1500),
            (1200, 900),
            (1200, 900),
        ],
        6,
        5,
    ),
    // 96% of the usable area: only the exact search finds the single sheet.
    (
        A3,
        50,
        30,
        &[
            (1000, 1500),
            (1200, 900),
            (700, 500),
            (2100, 1500),
            (500, 700),
            (900, 1200),
            (1200, 900),
            (1800, 1300),
        ],
        2,
        1,
    ),
];

#[test]
fn fixtures_old_was_worse_new_is_optimal() {
    assert!(
        FIXTURES.len() >= 3,
        "keep at least three regression fixtures"
    );
    for &(sheet, margin, gap, items, old, best) in FIXTURES {
        let input = fixture(sheet, margin, gap, items);
        assert_eq!(pack_greedy_only(&input), old, "{}", describe(&input));
        assert_eq!(optimum(&input), best, "{}", describe(&input));
        assert!(best < old);
        let out = check_layout(&input, Some(best));
        assert_eq!(out.sheets.len(), best, "{}", describe(&input));
    }
}

#[test]
fn never_worse_than_old_and_optimal_on_small_instances() {
    let mut state = 0x2545_F491;
    let (mut worse_old, mut checked) = (0, 0);
    for _ in 0..3000 {
        let input = instance(&mut state);
        let old = pack_greedy_only(&input);
        let new = check_layout(&input, None).sheets.len();
        assert!(new <= old, "{}: new {new} > old {old}", describe(&input));
        // At the area bound the layout is optimal; otherwise search every grouping.
        let best = if new == lower_bound(&input) {
            new
        } else {
            checked += 1;
            optimum(&input)
        };
        assert_eq!(new, best, "{}", describe(&input));
        worse_old += usize::from(old > best);
    }
    // The sample must hold cases the first release got wrong, or it proves little.
    assert!(
        worse_old >= 5,
        "old above optimum only {worse_old} times ({checked} searched)"
    );
}

/// Prints instances where the first release is above the optimum.
/// Run with `cargo test --release search_for_fixtures -- --ignored --nocapture`.
#[test]
#[ignore]
fn search_for_fixtures() {
    let mut state = 0x1234_5678;
    let count = 20_000;
    let (mut worse_old, mut worse_new, mut searched) = (0, 0, 0);
    for _ in 0..count {
        let input = instance(&mut state);
        let old = pack_greedy_only(&input);
        if old == lower_bound(&input) {
            continue;
        }
        searched += 1;
        let best = optimum(&input);
        if old > best {
            worse_old += 1;
            let new = pack(&input).sheets.len();
            worse_new += usize::from(new > best);
            println!("old {old} new {new} best {best}: {}", describe(&input));
        }
    }
    println!(
        "{count} instances, {searched} above the area bound searched exhaustively: old above optimum {worse_old}, new above optimum {worse_new}"
    );
}

/// Effort of the app's "Reorganizar encaixe" (`REORGANIZE_EFFORT` in useSheetLayout.ts).
const REORGANIZE_EFFORT: u32 = 10;

/// Times 60 mixed frames at the default and the reorganize effort.
/// Run with `cargo test --release time_sixty_frames -- --ignored --nocapture`.
#[test]
#[ignore]
fn time_sixty_frames() {
    let mut state = 0xDEAD_BEEF;
    for (paper, label) in [(PAPERS[0], "A4"), (PAPERS[1], "A3")] {
        for round in 0..3 {
            let items: Vec<(u32, u32)> = (0..60)
                .map(|_| SIZES[(next(&mut state) % 6) as usize])
                .collect();
            let mut input = fixture(paper, 50, 30, &items);
            for effort in [1, REORGANIZE_EFFORT] {
                input.effort = Some(effort);
                let start = std::time::Instant::now();
                let out = pack(&input);
                let took = start.elapsed();
                println!(
                    "{label} #{round} effort {effort}: {} sheets (old {}, bound {}) in {took:?}",
                    out.sheets.len(),
                    pack_greedy_only(&input),
                    lower_bound(&input)
                );
            }
        }
    }
}

/// Sheets saved over the first release by the default and reorganize efforts, 10 to 39 items.
/// Run with `cargo test --release effort_headroom -- --ignored --nocapture`.
#[test]
#[ignore]
fn effort_headroom() {
    let mut state = 0x0BAD_F00D;
    let (mut gain1, mut gain_high, mut total) = (0, 0, 0);
    let mut worst = std::time::Duration::ZERO;
    for _ in 0..300 {
        let n = 10 + next(&mut state) % 30;
        let items: Vec<(u32, u32)> = (0..n)
            .map(|_| SIZES[(next(&mut state) % 6) as usize])
            .collect();
        let paper = PAPERS[(next(&mut state) % 2) as usize];
        let mut input = fixture(paper, 50, 30, &items);
        let old = pack_greedy_only(&input);
        let start = std::time::Instant::now();
        let d = pack(&input).sheets.len();
        worst = worst.max(start.elapsed());
        input.effort = Some(REORGANIZE_EFFORT);
        let high = pack(&input).sheets.len();
        input.effort = Some(32);
        let e32 = pack(&input).sheets.len();
        gain1 += old - d;
        gain_high += old - high;
        total += usize::from(e32 < d);
        if e32 < d {
            println!("default {d} reorganize {high} e32 {e32} old {old}");
        }
    }
    println!(
        "sheets saved: default {gain1}, reorganize {gain_high}; effort 32 beat default on {total}; worst default {worst:?}"
    );
}

/// Odd millimetre sizes make the exact search's grid fine; its setup and cells are charged
/// to the budget, so the default effort stays quick. The bound is loose on purpose (tests
/// build with optimizations; a typical run takes a few milliseconds).
#[test]
fn odd_sizes_stay_fast() {
    const ODD: [(u32, u32); 3] = [(970, 1430), (1310, 1770), (630, 890)];
    let mut state = 0x5EED_0DD5;
    let (mut worst, mut searched) = (std::time::Duration::ZERO, 0);
    for round in 0..60 {
        let n = 8 + next(&mut state) % 5;
        let items: Vec<(u32, u32)> = (0..n)
            .map(|_| ODD[(next(&mut state) % 3) as usize])
            .collect();
        let paper = PAPERS[round % 2];
        let input = fixture(paper, 50, 30, &items);
        let start = std::time::Instant::now();
        let out = check_layout(&input, None);
        worst = worst.max(start.elapsed());
        let old = pack_greedy_only(&input);
        assert!(out.sheets.len() <= old);
        searched += usize::from(old > lower_bound(&input));
    }
    println!("odd sizes, 8 to 12 items: worst {worst:?}, {searched} of 60 reached phase two");
    assert!(searched >= 6, "too few rounds reach the second phase");
    assert!(
        worst < std::time::Duration::from_millis(200),
        "took {worst:?}"
    );
}
