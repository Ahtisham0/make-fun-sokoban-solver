// sokoban-solver-01: decompose each level into a hallway plus rooms, solve
// every room push-optimally with A* over pushes (player-reachability regions,
// Hungarian matching heuristic over push-distance tables, deadlock pruning),
// then stitch the rooms together with hallway walks.
// Deterministic: fixed work budgets, fixed tie-breaking, no clock, no
// randomness, no environment reads except the harness's input/output dirs.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const I = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const O = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// Fixed work budgets (expansions), never the wall clock, so two runs agree.
const BUDGET_OPTIMAL = 150_000;
const BUDGET_WEIGHTED = 150_000;
const BUDGET_GREEDY = 250_000;
const BUDGET_GLOBAL = 1_200_000;
let globalExpansions = 0;

const INF = 1e9;
const DIRS = [
  { dx: 0, dy: -1, ch: 'u' },
  { dx: 0, dy: 1, ch: 'd' },
  { dx: -1, dy: 0, ch: 'l' },
  { dx: 1, dy: 0, ch: 'r' },
];
const OPP = [1, 0, 3, 2];
// Permutations of [0..m-1] for the matching heuristic (m = 3 or 4).
const PERMS: number[][][] = [[], [], [], [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]], [[0, 1, 2, 3], [0, 1, 3, 2], [0, 2, 1, 3], [0, 2, 3, 1], [0, 3, 1, 2], [0, 3, 2, 1], [1, 0, 2, 3], [1, 0, 3, 2], [1, 2, 0, 3], [1, 2, 3, 0], [1, 3, 0, 2], [1, 3, 2, 0], [2, 0, 1, 3], [2, 0, 3, 1], [2, 1, 0, 3], [2, 1, 3, 0], [2, 3, 0, 1], [2, 3, 1, 0], [3, 0, 1, 2], [3, 0, 2, 1], [3, 1, 0, 2], [3, 1, 2, 0], [3, 2, 0, 1], [3, 2, 1, 0]]];

interface Level {
  w: number;
  h: number;
  wall: Uint8Array;
  goal: Uint8Array;
  boxes: number[];
  player: number;
}

function parseLevel(text: string): Level {
  const rows = text.split('\n').filter((r) => r.length > 0);
  const w = Math.max(...rows.map((r) => r.length));
  const h = rows.length;
  const wall = new Uint8Array(w * h).fill(1);
  const goal = new Uint8Array(w * h);
  const boxes: number[] = [];
  let player = -1;
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const ch = row[x]!;
      const i = y * w + x;
      if (ch === '#') continue;
      wall[i] = 0;
      if (ch === '.' || ch === '*' || ch === '+') goal[i] = 1;
      if (ch === '$' || ch === '*') boxes.push(i);
      if (ch === '@' || ch === '+') player = i;
    }
  });
  return { w, h, wall, goal, boxes, player };
}

interface Room {
  // Walk cells are local 0..n-1 (room floor) plus n (the hallway entry cell).
  n: number;
  entry: number; // == n
  cells: number[]; // local -> global cell index (room cells only)
  localOf: Map<number, number>; // global -> local (room cells and entry cell)
  door: number; // door local index
  entryGlobal: number;
  doorGlobal: number;
  goals: number[]; // goal local indices
  goalMask: bigint;
  goalSet: Uint8Array; // per room cell
  boxes0: number[]; // initial box local indices, sorted
  nbr: number[][]; // walk neighbours: nbr[cell][dir] = local walk cell or -1
  dist: number[]; // dist[goalIdx * n + cell] = push distance (BFS steps) or INF
  deadSq: Uint8Array; // per room cell: no goal reachable
  blocks: number[][]; // 2x2 blocks: room-cell local indices in the block
  blocksByCell: number[][];
}

function buildRoom(cells: number[], doorGlobal: number, entryGlobal: number, L: Level): Room {
  const n = cells.length;
  const localOf = new Map<number, number>();
  cells.forEach((g, i) => localOf.set(g, i));
  // The entry cell is a separate walk cell, unless it is already a room cell
  // (whole-level fallback, where the player starts inside the room).
  const entryIsRoom = localOf.has(entryGlobal);
  const entry = entryIsRoom ? localOf.get(entryGlobal)! : n;
  const nWalk = entryIsRoom ? n : n + 1;
  if (!entryIsRoom) localOf.set(entryGlobal, entry);
  const nbr: number[][] = [];
  for (let c = 0; c < nWalk; c++) {
    const g = c < n ? cells[c]! : entryGlobal;
    const x = g % L.w;
    const y = Math.floor(g / L.w);
    const row: number[] = [];
    for (let d = 0; d < 4; d++) {
      const nx = x + DIRS[d]!.dx;
      const ny = y + DIRS[d]!.dy;
      if (nx < 0 || nx >= L.w || ny < 0 || ny >= L.h) {
        row.push(-1);
        continue;
      }
      const ng = ny * L.w + nx;
      row.push(localOf.has(ng) ? localOf.get(ng)! : -1);
    }
    nbr.push(row);
  }
  const goals: number[] = [];
  const goalSet = new Uint8Array(n);
  let goalMask = 0n;
  cells.forEach((g, i) => {
    if (L.goal[g]) {
      goals.push(i);
      goalSet[i] = 1;
      goalMask |= 1n << BigInt(i);
    }
  });
  const boxes0: number[] = [];
  cells.forEach((g, i) => {
    if (L.boxes.includes(g)) boxes0.push(i);
  });
  boxes0.sort((a, b) => a - b);
  // Push-distance tables: BFS from each goal over room cells.
  const dist = new Array<number>(goals.length * n).fill(INF);
  for (let gi = 0; gi < goals.length; gi++) {
    const start = goals[gi]!;
    const q: number[] = [start];
    dist[gi * n + start] = 0;
    for (let qi = 0; qi < q.length; qi++) {
      const c = q[qi]!;
      const d0 = dist[gi * n + c]!;
      for (let dir = 0; dir < 4; dir++) {
        const nb = nbr[c]![dir]!;
        if (nb < 0 || nb >= n) continue; // room cells only: no entry cell
        if (dist[gi * n + nb]! <= d0 + 1) continue;
        dist[gi * n + nb] = d0 + 1;
        q.push(nb);
      }
    }
  }
  const deadSq = new Uint8Array(n);
  for (let c = 0; c < n; c++) {
    let ok = false;
    for (let gi = 0; gi < goals.length; gi++) if (dist[gi * n + c]! < INF) ok = true;
    deadSq[c] = ok ? 0 : 1;
  }
  // 2x2 blocks (global grid), skipping any that hold the entry cell.
  const blocks: number[][] = [];
  for (const g of cells) {
    const x = g % L.w;
    const y = Math.floor(g / L.w);
    const quad = [g, g + 1, g + L.w, g + L.w + 1];
    if (x + 1 >= L.w || y + 1 >= L.h) continue;
    let hasEntry = false;
    const roomCells: number[] = [];
    let anyRoom = false;
    for (const q of quad) {
      if (q === entryGlobal) {
        hasEntry = true;
        break;
      }
      const li = localOf.get(q);
      if (li !== undefined && li < n) {
        roomCells.push(li);
        anyRoom = true;
      }
    }
    if (hasEntry || !anyRoom) continue;
    blocks.push(roomCells);
  }
  const blocksByCell: number[][] = Array.from({ length: n }, () => []);
  blocks.forEach((b, bi) => {
    for (const c of b) blocksByCell[c]!.push(bi);
  });
  const door = localOf.get(doorGlobal)!;
  return { n, entry, cells, localOf, door, entryGlobal, doorGlobal, goals, goalMask, goalSet, boxes0, nbr, dist, deadSq, blocks, blocksByCell };
}

// BFS over walk cells (local indices), boxes as walls. Returns a region bitmask.
function regionFrom(room: Room, start: number, occ: Uint8Array): bigint {
  let mask = 0n;
  const q: number[] = [start];
  mask |= 1n << BigInt(start);
  for (let qi = 0; qi < q.length; qi++) {
    const c = q[qi]!;
    for (let d = 0; d < 4; d++) {
      const nb = room.nbr[c]![d]!;
      if (nb < 0) continue;
      if ((mask >> BigInt(nb)) & 1n) continue;
      if (nb < room.n && occ[nb]) continue;
      mask |= 1n << BigInt(nb);
      q.push(nb);
    }
  }
  return mask;
}

function packBoxes(room: Room, boxes: number[]): number {
  let p = 0;
  for (let i = 0; i < boxes.length; i++) p |= boxes[i]! << (6 * i);
  return p;
}

function unpackBoxes(packed: number, m: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < m; i++) out.push((packed >> (6 * i)) & 63);
  return out;
}

// Minimum assignment of boxes to goals by push distance; INF when impossible.
function heuristic(room: Room, boxes: number[], cache: Map<number, number>): number {
  const packed = packBoxes(room, boxes);
  const hit = cache.get(packed);
  if (hit !== undefined) return hit;
  const m = boxes.length;
  const perms = PERMS[m]!;
  let best = INF;
  for (const perm of perms) {
    let s = 0;
    for (let i = 0; i < m; i++) {
      const d = room.dist[perm[i]! * room.n + boxes[i]!]!;
      if (d >= INF) {
        s = INF;
        break;
      }
      s += d;
    }
    if (s < best) best = s;
  }
  cache.set(packed, best);
  return best;
}

interface Push {
  box: number;
  dir: number;
}

interface RoomSolution {
  pushes: Push[];
  endRegion: bigint;
}

// A* over pushes. weight 1 = optimal, 2 = weighted, Infinity = greedy.
function astar(room: Room, requireExit: boolean, weight: number, budget: number): RoomSolution | null {
  const m = room.boxes0.length;
  const effBudget = Math.max(0, Math.min(budget, BUDGET_GLOBAL - globalExpansions));
  if (effBudget <= 0) return null;
  const cache = new Map<number, number>();
  const occ0 = new Uint8Array(room.n);
  for (const b of room.boxes0) occ0[b] = 1;
  const startRegion = regionFrom(room, room.entry, occ0);
  const startKey = (startRegion << BigInt(6 * m)) | BigInt(packBoxes(room, room.boxes0));
  // State arrays.
  const stBoxes: number[] = [packBoxes(room, room.boxes0)];
  const stRegion: bigint[] = [startRegion];
  const stG: number[] = [0];
  const stParent: number[] = [-1];
  const stPushBox: number[] = [-1];
  const stPushDir: number[] = [-1];
  const closed = new Map<bigint, number>([[startKey, 0]]);
  const h0 = heuristic(room, room.boxes0, cache);
  if (h0 >= INF) return null;
  // Heap entries [f, h, negG, seq, id]; smallest first.
  const heap: [number, number, number, number, number][] = [];
  let seq = 0;
  const less = (a: [number, number, number, number, number], b: [number, number, number, number, number]): boolean =>
    a[0] < b[0] || (a[0] === b[0] && (a[1] < b[1] || (a[1] === b[1] && (a[2] < b[2] || (a[2] === b[2] && a[3] < b[3])))));
  const heapPush = (e: [number, number, number, number, number]): void => {
    let i = heap.length;
    heap.push(e);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!less(heap[i]!, heap[p]!)) break;
      const t = heap[i]!;
      heap[i] = heap[p]!;
      heap[p] = t;
      i = p;
    }
  };
  const heapPop = (): [number, number, number, number, number] => {
    const top = heap[0]!;
    const last = heap.pop()!;
    if (heap.length > 0) {
      heap[0] = last;
      for (let i = 0; ; ) {
        let c = 2 * i + 1;
        if (c >= heap.length) break;
        if (c + 1 < heap.length && less(heap[c + 1]!, heap[c]!)) c++;
        if (!less(heap[c]!, heap[i]!)) break;
        const t = heap[i]!;
        heap[i] = heap[c]!;
        heap[c] = t;
        i = c;
      }
    }
    return top;
  };
  const fOf = (g: number, h: number): number => (weight === Infinity ? h : g + weight * h);
  heapPush([fOf(0, h0), h0, 0, seq++, 0]);
  let expansions = 0;
  while (heap.length > 0) {
    const [, , , , sid] = heapPop();
    const g = stG[sid]!;
    const boxesPacked = stBoxes[sid]!;
    const region = stRegion[sid]!;
    const key = (region << BigInt(6 * m)) | BigInt(boxesPacked);
    if (closed.get(key) !== g) continue; // a better path to this state was found
    const boxes = unpackBoxes(boxesPacked, m);
    // Goal test: every box on a goal (and, when required, the player can exit).
    let solved = true;
    for (const b of boxes) if (!room.goalSet[b]) solved = false;
    if (solved && requireExit && !((region >> BigInt(room.entry)) & 1n)) solved = false;
    if (solved) {
      const pushes: Push[] = [];
      for (let t = sid; t > 0; t = stParent[t]!) pushes.push({ box: stPushBox[t]!, dir: stPushDir[t]! });
      pushes.reverse();
      globalExpansions += expansions;
      return { pushes, endRegion: region };
    }
    if (expansions >= effBudget) break;
    expansions++;
    const occ = new Uint8Array(room.n);
    for (const b of boxes) occ[b] = 1;
    for (let bi = 0; bi < m; bi++) {
      const b = boxes[bi]!;
      for (let d = 0; d < 4; d++) {
        const target = room.nbr[b]![d]!;
        if (target < 0 || target >= room.n) continue; // boxes stay on room cells
        if (occ[target]) continue;
        const behind = room.nbr[b]![OPP[d]]!;
        if (behind < 0) continue;
        if (!((region >> BigInt(behind)) & 1n)) continue;
        // New boxes.
        const nb = boxes.slice();
        nb[bi] = target;
        nb.sort((a, b2) => a - b2);
        // Deadlock: dead square.
        let dead = false;
        for (const x of nb) if (room.deadSq[x]) dead = true;
        if (dead) continue;
        // Deadlock: 2x2 block full of walls/boxes (checked near the moved box).
        const occ2 = new Uint8Array(room.n);
        for (const x of nb) occ2[x] = 1;
        for (const blk of room.blocksByCell[target]!) {
          const cells = room.blocks[blk]!;
          let full = true;
          let hasLoose = false;
          for (const c of cells) {
            if (!occ2[c]) {
              full = false;
              break;
            }
            if (!room.goalSet[c]) hasLoose = true;
          }
          if (full && hasLoose) {
            dead = true;
            break;
          }
        }
        if (dead) continue;
        const h = heuristic(room, nb, cache);
        if (h >= INF) continue;
        const newRegion = regionFrom(room, b, occ2);
        const newPacked = packBoxes(room, nb);
        const newKey = (newRegion << BigInt(6 * m)) | BigInt(newPacked);
        const ng = g + 1;
        const prev = closed.get(newKey);
        if (prev !== undefined && prev <= ng) continue;
        closed.set(newKey, ng);
        const id = stBoxes.length;
        stBoxes.push(newPacked);
        stRegion.push(newRegion);
        stG.push(ng);
        stParent.push(sid);
        stPushBox.push(b);
        stPushDir.push(d);
        heapPush([fOf(ng, h), h, -ng, seq++, id]);
      }
    }
  }
  globalExpansions += expansions;
  return null;
}

function solveRoomBest(room: Room, requireExit: boolean): RoomSolution | null {
  return (
    astar(room, requireExit, 1, BUDGET_OPTIMAL) ??
    astar(room, requireExit, 2, BUDGET_WEIGHTED) ??
    astar(room, requireExit, Infinity, BUDGET_GREEDY)
  );
}

// BFS walk over global cells; walkable/blocked predicates on global indices.
// Returns the move string (lowercase) or null.
function bfsPath(L: Level, start: number, target: number, walkable: (g: number) => boolean, blocked: (g: number) => boolean): string | null {
  if (start === target) return '';
  const prev = new Map<number, [number, string]>();
  const q: number[] = [start];
  prev.set(start, [-1, '']);
  for (let qi = 0; qi < q.length; qi++) {
    const c = q[qi]!;
    const x = c % L.w;
    const y = Math.floor(c / L.w);
    for (let d = 0; d < 4; d++) {
      const nx = x + DIRS[d]!.dx;
      const ny = y + DIRS[d]!.dy;
      if (nx < 0 || nx >= L.w || ny < 0 || ny >= L.h) continue;
      const nb = ny * L.w + nx;
      if (prev.has(nb) || !walkable(nb) || blocked(nb)) continue;
      prev.set(nb, [c, DIRS[d]!.ch]);
      if (nb === target) {
        let s = '';
        let t = nb;
        while (t !== start) {
          const [p, ch] = prev.get(t)!;
          s = ch + s;
          t = p;
        }
        return s;
      }
      q.push(nb);
    }
  }
  return null;
}

// Replay a room's push list into concrete moves (walks + pushes).
// Returns the moves and the player's final global cell, or null.
function roomMoves(L: Level, room: Room, pushes: Push[]): { moves: string; endPlayer: number } | null {
  let moves = '';
  let playerLocal = room.entry;
  let boxes = room.boxes0.slice();
  const walkable = (g: number): boolean => room.localOf.has(g);
  for (const p of pushes) {
    const behind = room.nbr[p.box]![OPP[p.dir]]!;
    const occ = new Uint8Array(room.n);
    for (const b of boxes) occ[b] = 1;
    const blocked = (g: number): boolean => {
      const li = room.localOf.get(g);
      return li !== undefined && li < room.n && occ[li] === 1;
    };
    const startGlobal = room.cells[playerLocal] !== undefined ? room.cells[playerLocal]! : room.entryGlobal;
    const behindGlobal = behind === room.entry ? room.entryGlobal : room.cells[behind]!;
    const walk = bfsPath(L, startGlobal, behindGlobal, walkable, blocked);
    if (walk === null) return null;
    moves += walk;
    moves += DIRS[p.dir]!.ch;
    // Apply the push.
    const target = room.nbr[p.box]![p.dir]!;
    boxes = boxes.map((b) => (b === p.box ? target : b));
    boxes.sort((a, b) => a - b);
    playerLocal = p.box;
  }
  const endPlayer = playerLocal === room.entry ? room.entryGlobal : room.cells[playerLocal]!;
  return { moves, endPlayer };
}

// Flood fill from a door over non-wall cells, excluding the hallway row.
function floodRoom(L: Level, doorGlobal: number, hy: number): number[] {
  const out: number[] = [];
  const seen = new Set<number>([doorGlobal]);
  const q: number[] = [doorGlobal];
  for (let qi = 0; qi < q.length; qi++) {
    const c = q[qi]!;
    out.push(c);
    const x = c % L.w;
    const y = Math.floor(c / L.w);
    for (let d = 0; d < 4; d++) {
      const nx = x + DIRS[d]!.dx;
      const ny = y + DIRS[d]!.dy;
      if (nx < 0 || nx >= L.w || ny < 0 || ny >= L.h || ny === hy) continue;
      const nb = ny * L.w + nx;
      if (L.wall[nb] || seen.has(nb)) continue;
      seen.add(nb);
      q.push(nb);
    }
  }
  return out;
}

function solveLevel(text: string): string {
  const L = parseLevel(text);
  if (L.player < 0) return '';
  const hy = Math.floor(L.player / L.w);
  // Doors: non-wall cells in the rows beside the hallway, above a hallway cell.
  const doorList: { door: number; entry: number }[] = [];
  for (const dy of [-1, 1]) {
    const r = hy + dy;
    if (r < 0 || r >= L.h) continue;
    for (let x = 0; x < L.w; x++) {
      const g = r * L.w + x;
      if (L.wall[g]) continue;
      const entry = hy * L.w + x;
      if (L.wall[entry]) continue;
      doorList.push({ door: g, entry });
    }
  }
  const rooms: Room[] = [];
  const claimed = new Set<number>();
  for (const d of doorList) {
    if (claimed.has(d.door)) continue;
    const comp = floodRoom(L, d.door, hy);
    for (const c of comp) claimed.add(c);
    const room = buildRoom(comp, d.door, d.entry, L);
    if (room.boxes0.length === 0) continue;
    rooms.push(room);
  }
  rooms.sort((a, b) => a.doorGlobal % L.w - (b.doorGlobal % L.w));
  // Fallback: no rooms found — treat the whole floor as one room.
  if (rooms.length === 0) {
    const cells: number[] = [];
    for (let i = 0; i < L.w * L.h; i++) if (!L.wall[i]) cells.push(i);
    const room = buildRoom(cells, L.player, L.player, L);
    rooms.push(room);
  }
  // Every box must sit in exactly one room, and each room's boxes must match its goals.
  const accounted = new Set<number>();
  for (const r of rooms) {
    for (const b of r.boxes0) accounted.add(r.cells[b]!);
    if (r.boxes0.length !== r.goals.length) return '';
  }
  for (const b of L.boxes) if (!accounted.has(b)) return '';
  // Solve every room unconstrained first.
  const sols: (RoomSolution | null)[] = rooms.map((r) => solveRoomBest(r, false));
  for (const s of sols) if (s === null) return '';
  // Rooms whose optimal solution traps the player (cannot reach the entry).
  const trapping: number[] = [];
  for (let i = 0; i < rooms.length; i++) {
    const s = sols[i]!;
    if (!((s.endRegion >> BigInt(rooms[i]!.entry)) & 1n)) trapping.push(i);
  }
  // Order: non-trapping rooms, then trapping rooms re-solved to allow an exit,
  // then one trapping room solved last (no exit needed).
  const order: { room: Room; sol: RoomSolution }[] = [];
  const lastTrap = trapping.length > 0 ? trapping[0]! : -1;
  for (let i = 0; i < rooms.length; i++) {
    if (trapping.includes(i)) continue;
    order.push({ room: rooms[i]!, sol: sols[i]! });
  }
  for (const i of trapping) {
    if (i === lastTrap) continue;
    const s = solveRoomBest(rooms[i]!, true);
    if (s === null) return '';
    order.push({ room: rooms[i]!, sol: s });
  }
  if (lastTrap >= 0) order.push({ room: rooms[lastTrap]!, sol: sols[lastTrap]! });
  // Stitch: hallway walk, room moves, exit walk, repeat.
  let moves = '';
  let player = L.player;
  const hallwayWalkable = (g: number): boolean => Math.floor(g / L.w) === hy && !L.wall[g];
  const neverBlocked = (): boolean => false;
  for (let oi = 0; oi < order.length; oi++) {
    const { room, sol } = order[oi]!;
    const walk = bfsPath(L, player, room.entryGlobal, hallwayWalkable, neverBlocked);
    if (walk === null) return '';
    moves += walk;
    const rm = roomMoves(L, room, sol.pushes);
    if (rm === null) return '';
    moves += rm.moves;
    player = rm.endPlayer;
    // Exit walk to the entry cell (not needed after the last room).
    if (oi < order.length - 1) {
      const occ = new Uint8Array(room.n);
      // Final boxes: replay the pushes to know where they ended.
      let boxes = room.boxes0.slice();
      for (const p of sol.pushes) {
        const target = room.nbr[p.box]![p.dir]!;
        boxes = boxes.map((b) => (b === p.box ? target : b));
      }
      for (const b of boxes) occ[b] = 1;
      const walkable = (g: number): boolean => room.localOf.has(g);
      const blocked = (g: number): boolean => {
        const li = room.localOf.get(g);
        return li !== undefined && li < room.n && occ[li] === 1;
      };
      const exit = bfsPath(L, player, room.entryGlobal, walkable, blocked);
      if (exit === null) return '';
      moves += exit;
      player = room.entryGlobal;
    }
  }
  return moves;
}

for (const id of readdirSync(I).sort()) {
  const moves = solveLevel(readFileSync(join(I, id, 'level.txt'), 'utf8'));
  mkdirSync(join(O, id), { recursive: true });
  writeFileSync(join(O, id, 'solution.txt'), `${moves}\n`);
}
