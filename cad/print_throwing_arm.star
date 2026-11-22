# Standalone Bambu Lab H2S Print & Multi-Nozzle Test for MTC-180 v5 Monolithic Throwing Arm + Cam + 6-Notch Quadrant
load("throwing_arm.star", "build_throwing_arm")

arm = build_throwing_arm(name="mtc180_throwing_arm")

export(arm, "mtc180_throwing_arm.stl", tolerance=0.01)
export(arm, "mtc180_throwing_arm_h2s.3mf", flavor=flavor.bambu, plate="MTC-180 v5 Throwing Arm + Cam + 6-Notch Quadrant (H2S)", name="mtc180_throwing_arm", printer="bambu_h2s")
plate_images("mtc180_throwing_arm_h2s.3mf", background="studio")

dwg = drawing(
    arm, view="three-view", sheet="A3", hidden="dashed", units="mm",
    title="MTC-180 v5 Monolithic Throwing Arm (R=98mm Cam + 6-Notch Sear Quadrant + Self-Centering Open V-Cup)",
    name="throwing_arm_sheet",
)
export_pdf(dwg, "mtc180_throwing_arm_drawing.pdf")
export_svg(dwg, "mtc180_throwing_arm_drawing.svg")


def verify_throwing_arm_h2s():
    assert_solid(arm)
    assert_printable(arm, printer="bambu_h2s", nozzle=0.4, layer_height=0.28, max_overhang=46)
    assert_printable(arm, printer="bambu_h2s", nozzle=0.6, layer_height=0.40, max_overhang=46)
    assert_printable(arm, printer="bambu_h2s", nozzle=0.8, layer_height=0.44, max_overhang=46)
    return arm.volume()


test("monolithic throwing arm passes H2S 0.4, 0.6 TC, and 0.8 TC printability with zero supports", verify_throwing_arm_h2s)
