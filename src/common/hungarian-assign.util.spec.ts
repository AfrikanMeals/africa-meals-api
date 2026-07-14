import {
  hungarianAssign,
  buildCostMatrix,
} from './hungarian-assign.util';

describe('hungarian-assign.util', () => {
  it('assigne 2×2 coût minimal', () => {
    // order0→courier1 (1), order1→courier0 (2) = total 3 (optimal)
    const assignment = hungarianAssign([
      [4, 1],
      [2, 5],
    ]);
    expect(assignment).toEqual([1, 0]);
  });

  it('matrice rectangulaire (plus de livreurs)', () => {
    const assignment = hungarianAssign([
      [10, 1, 8],
      [9, 7, 2],
    ]);
    expect(assignment[0]).toBe(1);
    expect(assignment[1]).toBe(2);
  });

  it('buildCostMatrix + assign', () => {
    const orders = ['o1', 'o2'];
    const couriers = ['c1', 'c2'];
    const costs: Record<string, number> = {
      'o1:c1': 5,
      'o1:c2': 1,
      'o2:c1': 2,
      'o2:c2': 9,
    };
    const matrix = buildCostMatrix(
      orders,
      couriers,
      (o, c) => costs[`${o}:${c}`] ?? 999,
    );
    const assignment = hungarianAssign(matrix);
    expect(couriers[assignment[0]!]).toBe('c2');
    expect(couriers[assignment[1]!]).toBe('c1');
  });
});
