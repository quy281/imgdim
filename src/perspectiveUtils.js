/**
 * Perspective Utils — Homography computation & perspective-corrected measurement
 * 
 * Uses a known reference rectangle (e.g. 300×400mm board) to compute a 3×3 
 * homography matrix that maps image pixels → real-world coordinates (mm).
 * 
 * Math: Solves Ax=b where A is 8×8 from 4 point correspondences.
 */

/**
 * Compute 3×3 homography matrix from 4 source points (pixel) to 4 destination points (mm).
 * @param {Array<{x,y}>} src - 4 image points [TL, TR, BR, BL]
 * @param {Array<{x,y}>} dst - 4 real-world points [TL, TR, BR, BL]
 * @returns {number[]} 9-element array representing 3×3 matrix (row-major)
 */
export function computeHomography(src, dst) {
  // Build 8×9 matrix for DLT (Direct Linear Transform)
  // For each point pair: 2 equations
  const A = [];
  for (let i = 0; i < 4; i++) {
    const sx = src[i].x, sy = src[i].y;
    const dx = dst[i].x, dy = dst[i].y;
    A.push([-sx, -sy, -1, 0, 0, 0, sx * dx, sy * dx, dx]);
    A.push([0, 0, 0, -sx, -sy, -1, sx * dy, sy * dy, dy]);
  }

  // Solve using simplified approach: set h33 = 1, solve 8×8 system
  // Rearrange: [A_8x8] * [h11..h32] = [-col9]
  const M = [];
  const b = [];
  for (let i = 0; i < 8; i++) {
    M.push(A[i].slice(0, 8));
    b.push(-A[i][8]);
  }

  const h = solveLinearSystem(M, b);
  return [...h, 1]; // h33 = 1
}

/**
 * Solve 8×8 linear system using Gaussian elimination with partial pivoting
 */
function solveLinearSystem(A, b) {
  const n = A.length;
  // Augmented matrix
  const aug = A.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < n; col++) {
    // Partial pivoting
    let maxRow = col;
    let maxVal = Math.abs(aug[col][col]);
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(aug[row][col]) > maxVal) {
        maxVal = Math.abs(aug[row][col]);
        maxRow = row;
      }
    }
    [aug[col], aug[maxRow]] = [aug[maxRow], aug[col]];

    const pivot = aug[col][col];
    if (Math.abs(pivot) < 1e-12) return null; // Singular

    // Eliminate below
    for (let row = col + 1; row < n; row++) {
      const factor = aug[row][col] / pivot;
      for (let j = col; j <= n; j++) {
        aug[row][j] -= factor * aug[col][j];
      }
    }
  }

  // Back substitution
  const x = new Array(n);
  for (let i = n - 1; i >= 0; i--) {
    x[i] = aug[i][n];
    for (let j = i + 1; j < n; j++) {
      x[i] -= aug[i][j] * x[j];
    }
    x[i] /= aug[i][i];
  }
  return x;
}

/**
 * Apply homography to transform a pixel point → real-world coordinates (mm)
 * @param {number[]} H - 9-element homography matrix
 * @param {{x,y}} point - pixel coordinates
 * @returns {{x,y}} real-world coordinates in mm
 */
export function applyHomography(H, point) {
  const w = H[6] * point.x + H[7] * point.y + H[8];
  if (Math.abs(w) < 1e-12) return { x: 0, y: 0 };
  return {
    x: (H[0] * point.x + H[1] * point.y + H[2]) / w,
    y: (H[3] * point.x + H[4] * point.y + H[5]) / w
  };
}

/**
 * Measure the real-world distance (mm) between two pixel points using homography
 * @param {number[]} H - homography matrix
 * @param {{x,y}} p1 - first pixel point
 * @param {{x,y}} p2 - second pixel point
 * @returns {number} distance in mm
 */
export function measureRealDistance(H, p1, p2) {
  const r1 = applyHomography(H, p1);
  const r2 = applyHomography(H, p2);
  return Math.sqrt((r2.x - r1.x) ** 2 + (r2.y - r1.y) ** 2);
}

/**
 * Get the two vanishing points from the calibration quadrilateral
 * VP1 = intersection of top & bottom edges (horizontal vanish)
 * VP2 = intersection of left & right edges (vertical vanish)
 * @param {Array<{x,y}>} pts - 4 corner points [TL, TR, BR, BL]
 * @returns {{vp1: {x,y}, vp2: {x,y}}}
 */
export function getVanishingPoints(pts) {
  const [tl, tr, br, bl] = pts;
  const vp1 = lineIntersection(tl, tr, bl, br); // top edge ∩ bottom edge
  const vp2 = lineIntersection(tl, bl, tr, br); // left edge ∩ right edge
  return { vp1, vp2 };
}

/**
 * Find intersection of two lines (p1-p2) and (p3-p4)
 */
function lineIntersection(p1, p2, p3, p4) {
  const x1 = p1.x, y1 = p1.y, x2 = p2.x, y2 = p2.y;
  const x3 = p3.x, y3 = p3.y, x4 = p4.x, y4 = p4.y;
  const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (Math.abs(denom) < 1e-10) return null; // Parallel
  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;
  return { x: x1 + t * (x2 - x1), y: y1 + t * (y2 - y1) };
}
