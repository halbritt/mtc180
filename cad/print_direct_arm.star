# Bambu Lab H2S print plate + checks for the MTC-180 direct-drive rail arm (bolts onto mtc180_bail_coupler)
load("bail_coupler.star", "build_bail_coupler", "X_MIN", "X_M4", "M4_YS")
load("direct_arm.star", "build_direct_arm", "L_TIP", "PEG_X0", "PEG_PITCH", "PEG_COUNT", "FLOOR_T", "BOSS_H")

arm = build_direct_arm(name="mtc180_direct_arm")

export(arm, "mtc180_direct_arm.stl", tolerance=0.01)
export(arm, "mtc180_direct_arm_h2s.3mf", flavor=flavor.bambu, plate="MTC-180 Direct-Drive Rail Arm (H2S)", name="mtc180_direct_arm", printer="bambu_h2s")
plate_images("mtc180_direct_arm_h2s.3mf", background="studio")

dwg = drawing(
    arm, view="three-view", sheet="A3", scale="1:1", hidden="dashed", units="mm",
    title="MTC-180 Direct-Drive Rail Arm (1:1 - bolts to the 3-bail coupler, ball rolls on two rails)",
    name="direct_arm_sheet",
)
export_pdf(dwg, "mtc180_direct_arm_drawing.pdf")
export_svg(dwg, "mtc180_direct_arm_drawing.svg")


def verify_direct_arm():
    assert_solid(arm)
    assert_printable(arm, printer="bambu_h2s", nozzle=0.4, layer_height=0.28, max_overhang=46)
    assert_printable(arm, printer="bambu_h2s", nozzle=0.6, layer_height=0.40, max_overhang=46)
    assert_printable(arm, printer="bambu_h2s", nozzle=0.8, layer_height=0.44, max_overhang=46)
    # Same spring keep-out as the coupler: nothing inboard of X = 28.4 mm
    spring_zone = box(28.4, 150.0, 40.0, at=(0.0, -75.0, -1.0), name="spring_keepout")
    assert_true(not distance(arm, spring_zone).overlap, msg="Arm encroaches into the X < 28.4 mm torsion-spring zone")
    # The bed face must seat flat on the coupler's driven face, with all six pilots on the coupler's M4 axes
    cp = build_bail_coupler(name="chk_coupler").rotate(180.0, axis=(1.0, 0.0, 0.0), name="chk_coupler_flipped")
    d = distance(arm, cp)
    assert_true(not d.overlap and d.distance < 0.05, msg="Arm does not seat flush on the coupler face (gap=%s)" % d.distance)
    for i, y_m in enumerate(M4_YS):
        pin = cylinder(1.5, BOSS_H + 5.0, at=(X_M4, y_m, -5.2), name="m4_probe_%d" % i)
        assert_true(not distance(arm, pin).overlap, msg="Pilot %d is off the coupler M4 axis" % i)
        assert_true(not distance(cp, pin).overlap, msg="Coupler hole %d is off the arm pilot axis" % i)
    for k in range(PEG_COUNT):
        pin = cylinder(2.0, FLOOR_T + 2.0, at=(PEG_X0 + PEG_PITCH * k, 0.0, -1.0), name="peg_probe_%d" % k)
        assert_true(not distance(arm, pin).overlap, msg="Backstop hole %d is blocked" % k)
    return arm.volume()


test("direct-drive rail arm: H2S 0.4/0.6/0.8 printable, spring keep-out, seats on coupler M4 pattern", verify_direct_arm)
