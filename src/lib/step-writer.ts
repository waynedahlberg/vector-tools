// Minimal ISO 10303-21 (STEP AP214) writer for planar 2D geometry at Z = 0.
// Emits wireframe curves (GEOMETRIC_CURVE_SET) and/or planar trimmed faces
// (SHELL_BASED_SURFACE_MODEL), each as its own representation under one part.

import { flatten, signedArea, type EllipseShape, type PathShape, type Pt, type Shape } from "./geometry";

export type CurveMode = "spline" | "polyline";
export type OutputUnit = "mm" | "in";
/** Which world plane the 2D drawing lies on: XY (top), XZ (front) or YZ (side). */
export type DrawingPlane = "xy" | "xz" | "yz";

/** Maps drawing coordinates (u, v) onto the chosen world plane. */
export function planeMap(plane: DrawingPlane) {
  const to3 = (u: number, v: number): [number, number, number] =>
    plane === "xy" ? [u, v, 0] : plane === "xz" ? [u, 0, v] : [0, u, v];
  // The plane normal is u × v, so counter-clockwise in the drawing stays counter-clockwise about it.
  const normal: [number, number, number] = plane === "xy" ? [0, 0, 1] : plane === "xz" ? [0, -1, 0] : [1, 0, 0];
  return { to3, normal, uAxis: to3(1, 0) };
}

export type Region = { outer: Shape; holes: Shape[] };

export type StepInput = {
  productName: string;
  fileName: string;
  unit: OutputUnit;
  curveMode: CurveMode;
  tolerance: number; // polyline flattening tolerance, output units
  plane: DrawingPlane;
  curves: Shape[] | null; // wireframe curves to emit, or null to skip
  regions: Region[] | null; // planar faces to emit, or null to skip
};

function real(n: number): string {
  if (!Number.isFinite(n) || Math.abs(n) < 1e-12) return "0.";
  const r = parseFloat(n.toPrecision(15));
  const s = String(r);
  if (s.includes("e")) {
    const [mant, exp] = s.split("e");
    return `${mant.includes(".") ? mant : mant + "."}E${exp}`;
  }
  return s.includes(".") ? s : s + ".";
}

function str(s: string): string {
  let out = "";
  for (const ch of s) {
    const code = ch.codePointAt(0)!;
    if (ch === "'") out += "''";
    else if (ch === "\\") out += "\\\\";
    else if (code >= 32 && code < 127) out += ch;
    else if (code <= 0xffff) out += `\\X2\\${code.toString(16).toUpperCase().padStart(4, "0")}\\X0\\`;
  }
  return `'${out}'`;
}

class Writer {
  private lines: string[] = [];
  private next = 1;
  add(entity: string): string {
    const id = `#${this.next++}`;
    this.lines.push(`${id}=${entity};`);
    return id;
  }
  body() {
    return this.lines.join("\n");
  }
}

export function writeStep(input: StepInput): string {
  const w = new Writer();
  const list = (ids: string[]) => `(${ids.join(",")})`;
  const map = planeMap(input.plane);
  const xyz = (u: number, v: number) => map.to3(u, v).map(real).join(",");
  const pointCache = new Map<string, string>();
  const point = (p: Pt) => {
    const key = `${real(p.x)},${real(p.y)}`;
    let id = pointCache.get(key);
    if (!id) {
      id = w.add(`CARTESIAN_POINT('',(${xyz(p.x, p.y)}))`);
      pointCache.set(key, id);
    }
    return id;
  };

  // --- Product structure --------------------------------------------------
  const appCtx = w.add(`APPLICATION_CONTEXT('core data for automotive mechanical design processes')`);
  w.add(`APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2000,${appCtx})`);
  const prodCtx = w.add(`PRODUCT_CONTEXT('',${appCtx},'mechanical')`);
  const product = w.add(`PRODUCT(${str(input.productName)},${str(input.productName)},'',(${prodCtx}))`);
  w.add(`PRODUCT_RELATED_PRODUCT_CATEGORY('part',$,(${product}))`);
  const pdf = w.add(`PRODUCT_DEFINITION_FORMATION('','',${product})`);
  const pdCtx = w.add(`PRODUCT_DEFINITION_CONTEXT('part definition',${appCtx},'design')`);
  const pd = w.add(`PRODUCT_DEFINITION('design','',${pdf},${pdCtx})`);
  const pds = w.add(`PRODUCT_DEFINITION_SHAPE('','',${pd})`);

  // --- Units and representation context ----------------------------------
  const mm = w.add(`(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT(.MILLI.,.METRE.))`);
  let lengthUnit = mm;
  if (input.unit === "in") {
    const dims = w.add(`DIMENSIONAL_EXPONENTS(1.,0.,0.,0.,0.,0.,0.)`);
    const factor = w.add(`LENGTH_MEASURE_WITH_UNIT(LENGTH_MEASURE(25.4),${mm})`);
    lengthUnit = w.add(`(CONVERSION_BASED_UNIT('INCH',${factor})LENGTH_UNIT()NAMED_UNIT(${dims}))`);
  }
  const rad = w.add(`(NAMED_UNIT(*)PLANE_ANGLE_UNIT()SI_UNIT($,.RADIAN.))`);
  const sr = w.add(`(NAMED_UNIT(*)SI_UNIT($,.STERADIAN.)SOLID_ANGLE_UNIT())`);
  const uncertainty = w.add(
    `UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(${input.unit === "in" ? "4.E-08" : "1.E-06"}),${lengthUnit},'distance_accuracy_value','confusion accuracy')`
  );
  const ctx = w.add(
    `(GEOMETRIC_REPRESENTATION_CONTEXT(3)GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((${uncertainty}))GLOBAL_UNIT_ASSIGNED_CONTEXT((${lengthUnit},${rad},${sr}))REPRESENTATION_CONTEXT('2D','3D context with units'))`
  );

  const origin = w.add(`CARTESIAN_POINT('',(0.,0.,0.))`);
  const dirZ = w.add(`DIRECTION('',(0.,0.,1.))`);
  const dirX = w.add(`DIRECTION('',(1.,0.,0.))`);
  const worldAxis = w.add(`AXIS2_PLACEMENT_3D('',${origin},${dirZ},${dirX})`);
  // Placement of the drawing plane: its normal and in-plane u direction.
  const onXY = input.plane === "xy";
  const normal = onXY ? dirZ : w.add(`DIRECTION('',(${map.normal.map(real).join(",")}))`);
  const uDir = onXY ? dirX : w.add(`DIRECTION('',(${map.uAxis.map(real).join(",")}))`);
  const planeAxis = onXY ? worldAxis : w.add(`AXIS2_PLACEMENT_3D('',${origin},${normal},${uDir})`);

  // --- Curve geometry -----------------------------------------------------
  const pathCurve = (s: PathShape): string => {
    if (input.curveMode === "polyline") {
      const pts = flatten(s, input.tolerance);
      return w.add(`POLYLINE(${str(s.name)},${list(pts.map(point))})`);
    }
    // One C0 cubic B-spline per subpath: lines are degree-elevated, so the curve is exact.
    // closed_curve stays .F. even for closed loops: some readers (OpenCASCADE) treat .T. as
    // periodic and reshape the curve. Coincident end points still close the loop.
    const ctrl: Pt[] = [s.segments[0].p0];
    for (const seg of s.segments) {
      if (seg.kind === "line") {
        ctrl.push(
          { x: seg.p0.x + (seg.p1.x - seg.p0.x) / 3, y: seg.p0.y + (seg.p1.y - seg.p0.y) / 3 },
          { x: seg.p0.x + ((seg.p1.x - seg.p0.x) * 2) / 3, y: seg.p0.y + ((seg.p1.y - seg.p0.y) * 2) / 3 },
          seg.p1
        );
      } else {
        ctrl.push(seg.p1, seg.p2, seg.p3);
      }
    }
    if (s.closed) ctrl[ctrl.length - 1] = ctrl[0];
    const n = s.segments.length;
    const mults = [4, ...Array(n - 1).fill(3), 4];
    const knots = Array.from({ length: n + 1 }, (_, i) => real(i));
    return w.add(
      `B_SPLINE_CURVE_WITH_KNOTS(${str(s.name)},3,${list(ctrl.map(point))},.UNSPECIFIED.,.F.,.F.,(${mults.join(",")}),(${knots.join(",")}),.UNSPECIFIED.)`
    );
  };

  const ellipseCurve = (s: EllipseShape): string => {
    if (input.curveMode === "polyline") {
      return w.add(`POLYLINE(${str(s.name)},${list(flatten(s, input.tolerance).map(point))})`);
    }
    const c = w.add(`CARTESIAN_POINT('',(${xyz(s.center.x, s.center.y)}))`);
    const ref = w.add(`DIRECTION('',(${xyz(s.axis.x, s.axis.y)}))`);
    const place = w.add(`AXIS2_PLACEMENT_3D('',${c},${normal},${ref})`);
    if (Math.abs(s.rx - s.ry) <= 1e-9 * Math.max(s.rx, 1)) {
      return w.add(`CIRCLE(${str(s.name)},${place},${real(s.rx)})`);
    }
    return w.add(`ELLIPSE(${str(s.name)},${place},${real(s.rx)},${real(s.ry)})`);
  };

  const curveFor = (s: Shape) => (s.type === "path" ? pathCurve(s) : ellipseCurve(s));

  const startPoint = (s: Shape): Pt => {
    if (s.type === "path") return s.segments[0].p0;
    return { x: s.center.x + s.axis.x * s.rx, y: s.center.y + s.axis.y * s.rx };
  };

  const items: string[] = [];

  if (input.curves?.length) {
    const curveIds = input.curves.map(curveFor);
    const set = w.add(`GEOMETRIC_CURVE_SET('curves',${list(curveIds)})`);
    const rep = w.add(`GEOMETRICALLY_BOUNDED_WIREFRAME_SHAPE_REPRESENTATION('curves',(${set},${worldAxis}),${ctx})`);
    items.push(rep);
  }

  if (input.regions?.length) {
    const plane = w.add(`PLANE('',${planeAxis})`);
    const loopFor = (s: Shape): { loop: string; ccw: boolean } => {
      const curve = curveFor(s);
      const vertex = w.add(`VERTEX_POINT('',${point(startPoint(s))})`);
      const edge = w.add(`EDGE_CURVE('',${vertex},${vertex},${curve},.T.)`);
      const oriented = w.add(`ORIENTED_EDGE('',*,*,${edge},.T.)`);
      // Ellipses are parameterised counter-clockwise about +Z.
      const ccw = s.type === "ellipse" ? true : signedArea(flatten(s, input.tolerance)) > 0;
      return { loop: w.add(`EDGE_LOOP('',(${oriented}))`), ccw };
    };
    const shells: string[] = [];
    input.regions.forEach((region, i) => {
      const outer = loopFor(region.outer);
      const bounds = [w.add(`FACE_OUTER_BOUND('',${outer.loop},${outer.ccw ? ".T." : ".F."})`)];
      for (const hole of region.holes) {
        const h = loopFor(hole);
        bounds.push(w.add(`FACE_BOUND('',${h.loop},${h.ccw ? ".F." : ".T."})`));
      }
      const face = w.add(`ADVANCED_FACE(${str(`face_${i + 1}`)},${list(bounds)},${plane},.T.)`);
      shells.push(w.add(`OPEN_SHELL('',(${face}))`));
    });
    const model = w.add(`SHELL_BASED_SURFACE_MODEL('faces',${list(shells)})`);
    items.push(w.add(`MANIFOLD_SURFACE_SHAPE_REPRESENTATION('faces',(${model},${worldAxis}),${ctx})`));
  }

  const shapeRep = w.add(`SHAPE_REPRESENTATION(${str(input.productName)},(${worldAxis}),${ctx})`);
  w.add(`SHAPE_DEFINITION_REPRESENTATION(${pds},${shapeRep})`);
  for (const rep of items) w.add(`SHAPE_REPRESENTATION_RELATIONSHIP('','',${shapeRep},${rep})`);

  const stamp = new Date().toISOString().replace(/\.\d+Z$/, "");
  return [
    "ISO-10303-21;",
    "HEADER;",
    "FILE_DESCRIPTION(('2D geometry converted from SVG'),'2;1');",
    `FILE_NAME(${str(input.fileName)},'${stamp}',(''),(''),'VectorTools','VectorTools','');`,
    "FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));",
    "ENDSEC;",
    "DATA;",
    w.body(),
    "ENDSEC;",
    "END-ISO-10303-21;",
    "",
  ].join("\n");
}
