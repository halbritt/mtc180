# MTC-180L-PL Crossbar Bail-Fit Verification Coupon (Exact 1:1 Crop X = 19.5..60.0 mm of Full Carrier)
# Tests all 3 traps (46.15mm flush pitch), 38.70mm C-to-C snap-jaws, 43.2mm crossbar slots/hooks,
# M3 bores, full 8.2mm outboard girders, and X=51.6mm sloped-wood tip clearance in ~6 min PETG!

load("carrier_positivelock.star", "build_positivelock_carrier", "TRAP_PITCH", "WIRE_HALF_CC")

full_carrier = build_positivelock_carrier(name="full_ref")
clip_box = box(42.0, 160.0, 9.2, at=(18.0, -80.0, -1.0), name="crossbar_clip")

coupon = intersect(full_carrier, clip_box, kernel=kernel.mesh, name="mtc180_crossbar_fit_coupon")
coupon.material(preset=preset.petg_glossy, color="#fd9644", roughness=0.32)

export(coupon, "mtc180_crossbar_fit_coupon.stl", tolerance=0.01)
export(coupon, "mtc180_crossbar_fit_coupon_h2s.3mf", flavor=flavor.bambu, plate="MTC-180 Crossbar Fit Coupon (H2S)", name="mtc180_crossbar_fit_coupon", printer="bambu_h2s")
plate_images("mtc180_crossbar_fit_coupon_h2s.3mf", background="studio")

dwg = drawing(
    coupon,
    view="three-view",
    sheet="A3",
    scale="1:1",
    hidden="dashed",
    units="mm",
    title="MTC-180L-PL Crossbar Bail-Fit Coupon (1:1 Scale — 46.15mm Pitch, 38.70mm C-to-C, 43.2mm Bail)",
    name="coupon_sheet",
)
export_pdf(dwg, "mtc180_crossbar_fit_coupon_drawing.pdf")
export_svg(dwg, "mtc180_crossbar_fit_coupon_drawing.svg")


def verify_coupon_h2s():
    assert_solid(coupon)
    assert_printable(coupon, printer="bambu_h2s", nozzle=0.4, layer_height=0.28, max_overhang=46)
    assert_printable(coupon, printer="bambu_h2s", nozzle=0.6, layer_height=0.40, max_overhang=46)
    assert_printable(coupon, printer="bambu_h2s", nozzle=0.8, layer_height=0.44, max_overhang=46)
    return coupon.volume()


test("crossbar fit coupon passes 0.4, 0.6 TC, and 0.8 TC H2S printability", verify_coupon_h2s)
