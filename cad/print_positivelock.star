# Standalone Print & Multi-Nozzle Test Entry Point for MTC-180L-PL (Positive-Lock Bail Interface)
load("carrier_positivelock.star", "build_positivelock_carrier", "L_BALL", "TRAP_PITCH", "WIRE_HALF_CC")

carrier = build_positivelock_carrier(name="mtc180_positivelock_petg")

export(carrier, "mtc180_positivelock_petg.stl", tolerance=0.01)
export(carrier, "mtc180_positivelock_petg_h2s.3mf", flavor=flavor.bambu, plate="MTC-180L-PL Snap+Hook+M3 (H2S)", name="mtc180_positivelock_petg", printer="bambu_h2s")
plate_images("mtc180_positivelock_petg_h2s.3mf", background="studio")

dwg = drawing(carrier, view="three-view", sheet="A3", hidden="dashed", units="mm", title="MTC-180L-PL Positive-Lock PETG Carrier (Snap-Jaws + Bail-Retainer Slot + M3 Clamp, Bambu H2S)", name="poslock_sheet")
export_pdf(dwg, "mtc180_positivelock_petg_drawing.pdf")
export_svg(dwg, "mtc180_positivelock_petg_drawing.svg")


def verify_poslock_nozzles():
    assert_solid(carrier)
    assert_printable(carrier, printer="bambu_h2s", nozzle=0.4, layer_height=0.28, max_overhang=46)
    assert_printable(carrier, printer="bambu_h2s", nozzle=0.6, layer_height=0.40, max_overhang=46)
    assert_printable(carrier, printer="bambu_h2s", nozzle=0.8, layer_height=0.44, max_overhang=46)
    return carrier.volume()


def verify_driven_side_seats():
    # +Z is the direction of travel: every wire must have solid plate ahead of it and an open channel behind it.
    for i, yc in enumerate([-TRAP_PITCH, 0.0, TRAP_PITCH]):
        for j, sgn in enumerate([-1.0, 1.0]):
            tag = "_%d%d" % (i, j)
            yw = yc + sgn * WIRE_HALF_CC
            ahead = box(18.0, 0.4, 1.2, at=(21.0, yw - 0.2, 4.7), name="probe_ahead" + tag)
            v = intersect(carrier, ahead, kernel=kernel.mesh, name="probe_hit" + tag).volume()
            assert_true(v > 0.98 * 18.0 * 0.4 * 1.2, msg="No solid plate ahead of the wire at y=%s (%s mm3)" % (yw, v))
            behind = box(18.0, 0.4, 2.0, at=(21.0, yw - 0.2, 0.05), name="probe_behind" + tag)
            assert_true(not distance(carrier, behind).overlap, msg="Wire channel at y=%s is not open to the trailing face" % yw)
    return carrier.volume()


test("bail wires bear on solid plate on the driven side", verify_driven_side_seats)
test("zero-warning H2S printability across 0.4, 0.6 TC, and 0.8 TC nozzles", verify_poslock_nozzles)
