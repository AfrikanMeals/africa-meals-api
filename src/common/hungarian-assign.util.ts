/**
 * Algorithme hongrois (Munkres) — affectation optimale 1-1 coût minimal.
 * Matrice rectangulaire OK (padding avec coûts élevés).
 * Alternative légère à OR-Tools pour N commandes × M livreurs.
 */

const INF = 1e12;

/**
 * @param costMatrix costMatrix[orderIndex][courierIndex] — plus bas = mieux
 * @returns assignment[orderIndex] = courierIndex ou -1 si non assigné
 */
export function hungarianAssign(costMatrix: number[][]): number[] {
  const nOrders = costMatrix.length;
  if (nOrders === 0) return [];
  const nCouriers = Math.max(0, ...costMatrix.map((row) => row.length));
  if (nCouriers === 0) return Array(nOrders).fill(-1);

  const n = Math.max(nOrders, nCouriers);
  const a: number[][] = Array.from({ length: n + 1 }, () =>
    Array(n + 1).fill(0),
  );
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= n; j++) {
      if (i <= nOrders && j <= nCouriers) {
        const v = Number(costMatrix[i - 1]![j - 1]);
        a[i]![j] = Number.isFinite(v) ? v : INF;
      } else {
        a[i]![j] = INF;
      }
    }
  }

  const u = Array(n + 1).fill(0);
  const v = Array(n + 1).fill(0);
  const p = Array(n + 1).fill(0);
  const way = Array(n + 1).fill(0);

  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = Array(n + 1).fill(INF);
    const used = Array(n + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0] as number;
      let delta = INF;
      let j1 = 0;
      for (let j = 1; j <= n; j++) {
        if (used[j]) continue;
        const cur = a[i0]![j]! - u[i0]! - v[j]!;
        if (cur < minv[j]!) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j]! < delta) {
          delta = minv[j]!;
          j1 = j;
        }
      }
      for (let j = 0; j <= n; j++) {
        if (used[j]) {
          u[p[j]!]! += delta;
          v[j]! -= delta;
        } else {
          minv[j]! -= delta;
        }
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0] as number;
      p[j0] = p[j1]!;
      j0 = j1;
    } while (j0 !== 0);
  }

  const assignment = Array(nOrders).fill(-1);
  for (let j = 1; j <= nCouriers; j++) {
    const i = p[j] as number;
    if (i >= 1 && i <= nOrders) {
      const cost = a[i]![j]!;
      if (cost < INF / 2) {
        assignment[i - 1] = j - 1;
      }
    }
  }
  return assignment;
}

/**
 * Construit une matrice de coûts à partir de scores précalculés.
 * scores[orderId][courierId] = coût (plus bas = mieux).
 */
export function buildCostMatrix(
  orderIds: string[],
  courierIds: string[],
  scoreOf: (orderId: string, courierId: string) => number,
): number[][] {
  return orderIds.map((oid) =>
    courierIds.map((cid) => {
      const s = Number(scoreOf(oid, cid));
      return Number.isFinite(s) ? s : INF;
    }),
  );
}
