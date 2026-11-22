# Standalone Bambu Lab H2S Print & Multi-Nozzle Test for MTC-180 v5 Spring-Cleared 3-Bail Coupler (M4 Hardware)
load("bail_coupler.star", "build_bail_coupler", "TRAP_PITCH", "WIRE_HALF_CC", "X_MIN")

coupler = build_bail_coupler(name="mtc180_bail_coupler")

export(coupler, "mtc180_bail_coupler.stl", tolerance=0.01)
export(coupler, "mtc180_bail_coupler_h2s.3mf", flavor=flavor.bambu, plate="MTC-180 v5 Spring-Cleared 3-Bail Coupler (H2S)", name="mtc180_bail_coupler", printer="bambu_h2s")
plate_images("mtc180_bail_coupler_h2s.3mf", background="studio")

dwg = drawing(
    coupler, view="three-view", sheet="A3", scale="1:1", hidden="dashed", units="mm",
    title="MTC-180 v5 Spring-Cleared Driven-Side 3-Bail Coupler (1:1 Scale — X >= 28.5mm Spring Clearance, M4 Locks)",
    name="bail_coupler_sheet",
)
export_pdf(dwg, "mtc180_bail_coupler_drawing.pdf")
export_svg(dwg, "mtc180_bail_coupler_drawing.svg")


def verify_coupler_print_and_loadpath():
    assert_solid(coupler)
    assert_printable(coupler, printer="bambu_h2s", nozzle=0.4, layer_height=0.28, max_overhang=46)
    assert_printable(coupler, printer="bambu_h2s", nozzle=0.6, layer_height=0.40, max_overhang=46)
    assert_printable(coupler, printer="bambu_h2s", nozzle=0.8, layer_height=0.44, max_overhang=46)
    # Verify X < 28.4 mm spring zone is 100% plastic-free and Z = 0..1.90 mm driven floor is solid under every wire
    spring_zone = box(28.4, 150.0, 12.0, at=(0.0, -75.0, -1.0), name="spring_keepout")
    assert_true(not distance(coupler, spring_zone).overlap, msg="Coupler encroaches into X < 28.4 mm torsion-spring zone")
    for i, yc in enumerate([-TRAP_PITCH, 0.0, TRAP_PITCH]):
        for j, sgn in enumerate([-1.0, 1.0]):
            yw = yc + sgn * WIRE_HALF_CC
            probe = box(10.0, 0.6, 1.2, at=(X_MIN + 1.0, yw - 0.3, 0.2), name="drv_%d%d" % (i, j))
            v = intersect(coupler, probe, kernel=kernel.mesh, name="hit_%d%d" % (i, j)).volume()
            assert_true(v > 0.98 * 10.0 * 0.6 * 1.2, msg="Missing solid driven floor under wire y=%s" % yw)
    return coupler.volume()


test("spring-cleared 3-bail coupler passes H2S 0.4/0.6/0.8 printability + spring keepout + driven floor", verify_coupler_print_and_loadpath)
