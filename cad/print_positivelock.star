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


test("zero-warning H2S printability across 0.4, 0.6 TC, and 0.8 TC nozzles", verify_poslock_nozzles)
