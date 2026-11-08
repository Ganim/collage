//! MaxRects bin packing for a single sheet. All values are in the same unit (tenths of mm).

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Heuristic {
    BestShortSide,
    BestArea,
    BottomLeft,
}

#[derive(Clone, Copy, Debug)]
struct Rect {
    x: u32,
    y: u32,
    w: u32,
    h: u32,
}

impl Rect {
    fn contains(&self, o: &Rect) -> bool {
        o.x >= self.x
            && o.y >= self.y
            && o.x + o.w <= self.x + self.w
            && o.y + o.h <= self.y + self.h
    }

    fn intersects(&self, o: &Rect) -> bool {
        o.x < self.x + self.w && self.x < o.x + o.w && o.y < self.y + self.h && self.y < o.y + o.h
    }
}

pub struct Bin {
    free: Vec<Rect>,
    /// Sum of the areas of the rectangles placed so far.
    pub used_area: u64,
    max_x: u32,
    max_y: u32,
}

/// A placement: top-left corner and whether the rectangle was rotated by 90 degrees.
pub struct Slot {
    pub x: u32,
    pub y: u32,
    pub rotated: bool,
}

impl Bin {
    pub fn new(w: u32, h: u32) -> Bin {
        Bin {
            free: vec![Rect { x: 0, y: 0, w, h }],
            used_area: 0,
            max_x: 0,
            max_y: 0,
        }
    }

    /// Area of the bounding box of everything placed so far.
    pub fn extent_area(&self) -> u64 {
        self.max_x as u64 * self.max_y as u64
    }

    /// Lower score is better.
    fn score(r: &Rect, w: u32, h: u32, heuristic: Heuristic) -> (u64, u64) {
        let lw = (r.w - w) as u64;
        let lh = (r.h - h) as u64;
        match heuristic {
            Heuristic::BestShortSide => (lw.min(lh), lw.max(lh)),
            Heuristic::BestArea => (r.w as u64 * r.h as u64 - w as u64 * h as u64, lw.min(lh)),
            Heuristic::BottomLeft => ((r.y + h) as u64, r.x as u64),
        }
    }

    fn find(&self, w: u32, h: u32, heuristic: Heuristic) -> Option<Slot> {
        let mut best: Option<((u64, u64), Slot)> = None;
        for r in &self.free {
            for rotated in [false, true] {
                let (iw, ih) = if rotated { (h, w) } else { (w, h) };
                if iw <= r.w && ih <= r.h {
                    let s = Self::score(r, iw, ih, heuristic);
                    if best.as_ref().is_none_or(|(b, _)| s < *b) {
                        best = Some((
                            s,
                            Slot {
                                x: r.x,
                                y: r.y,
                                rotated,
                            },
                        ));
                    }
                }
            }
        }
        best.map(|(_, slot)| slot)
    }

    /// Places a `w` x `h` rectangle, trying both orientations. Returns None if it does not fit.
    pub fn insert(&mut self, w: u32, h: u32, heuristic: Heuristic) -> Option<Slot> {
        let slot = self.find(w, h, heuristic)?;
        let (pw, ph) = if slot.rotated { (h, w) } else { (w, h) };
        let placed = Rect {
            x: slot.x,
            y: slot.y,
            w: pw,
            h: ph,
        };
        self.split_free(&placed);
        self.prune();
        self.used_area += w as u64 * h as u64;
        self.max_x = self.max_x.max(placed.x + placed.w);
        self.max_y = self.max_y.max(placed.y + placed.h);
        Some(slot)
    }

    fn split_free(&mut self, p: &Rect) {
        let mut next = Vec::with_capacity(self.free.len() + 4);
        for f in &self.free {
            if !f.intersects(p) {
                next.push(*f);
                continue;
            }
            if p.x > f.x {
                next.push(Rect {
                    x: f.x,
                    y: f.y,
                    w: p.x - f.x,
                    h: f.h,
                });
            }
            if p.x + p.w < f.x + f.w {
                next.push(Rect {
                    x: p.x + p.w,
                    y: f.y,
                    w: f.x + f.w - (p.x + p.w),
                    h: f.h,
                });
            }
            if p.y > f.y {
                next.push(Rect {
                    x: f.x,
                    y: f.y,
                    w: f.w,
                    h: p.y - f.y,
                });
            }
            if p.y + p.h < f.y + f.h {
                next.push(Rect {
                    x: f.x,
                    y: p.y + p.h,
                    w: f.w,
                    h: f.y + f.h - (p.y + p.h),
                });
            }
        }
        self.free = next;
    }

    /// Drops free rectangles contained in another one (keeping the first of identical ones).
    fn prune(&mut self) {
        let n = self.free.len();
        let mut keep = vec![true; n];
        for i in 0..n {
            for j in 0..n {
                if i == j || !keep[j] {
                    continue;
                }
                let identical =
                    self.free[i].contains(&self.free[j]) && self.free[j].contains(&self.free[i]);
                if self.free[j].contains(&self.free[i]) && (!identical || j < i) {
                    keep[i] = false;
                    break;
                }
            }
        }
        let mut idx = 0;
        self.free.retain(|_| {
            idx += 1;
            keep[idx - 1]
        });
    }
}
