# Standalone Bambu Lab H2S Print Layout & Multi-Nozzle Test for MTC-180 Wood-Board Trigger Kit
load("trigger_mechanism.star", "build_trigger_parts")

bridge, rocker, fairlead = build_trigger_parts(prefix="h2s_trig")

# Arrange all 3 flat zero-support parts cleanly on one compact H2S build plate
bridge_pl = bridge.translate((-26.0, -38.0, 0.0), name="mtc180_sear_bridge")
rocker_pl = rocker.translate((10.0, -41.0, 0.0), name="mtc180_coaxial_rocker_sear")
fairlead_pl = fairlead.translate((54.0, -18.0, 0.0), name="mtc180_rear_string_guide")
kit = [bridge_pl, rocker_pl, fairlead_pl]

export(kit, "mtc180_trigger_kit.stl", tolerance=0.01)
export(kit, "mtc180_trigger_kit_h2s.3mf", flavor=flavor.bambu, plate="MTC-180 Front Sear + Rear Pull-String Kit (H2S)", name="mtc180_trigger_kit", printer="bambu_h2s")
plate_images("mtc180_trigger_kit_h2s.3mf", background="studio")

dwg = drawing(
    kit,
    view="three-view",
    sheet="A3",
    scale="1:1",
    hidden="dashed",
    units="mm",
    title="MTC-180 Wood-Board Trigger Kit (Front Coaxial Sear + Outboard Rear Pull-String Guide)",
    name="trigger_sheet",
)
export_pdf(dwg, "mtc180_trigger_kit_drawing.pdf")
export_svg(dwg, "mtc180_trigger_kit_drawing.svg")


def verify_trigger_h2s():
    total_v = 0.0
    for p in kit:
        assert_solid(p)
        assert_printable(p, printer="bambu_h2s", nozzle=0.4, layer_height=0.28, max_overhang=46)
        assert_printable(p, printer="bambu_h2s", nozzle=0.6, layer_height=0.40, max_overhang=46)
        assert_printable(p, printer="bambu_h2s", nozzle=0.8, layer_height=0.44, max_overhang=46)
        total_v += p.volume()
    assert_true(not distance(bridge_pl, rocker_pl).overlap, msg="bridge/rocker plate overlap")
    assert_true(not distance(rocker_pl, fairlead_pl).overlap, msg="rocker/fairlead plate overlap")
    assert_true(not distance(bridge_pl, fairlead_pl).overlap, msg="bridge/fairlead plate overlap")
    return total_v


test("trigger kit passes 0.4, 0.6 TC, and 0.8 TC H2S printability with zero supports", verify_trigger_h2s)
