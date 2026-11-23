# Bambu Lab H2S print plate + checks for the MTC-180 direct-drive small parts:
# ball backstop, hook sear, sear clevis bracket and padded stop wedge.
load("direct_arm.star", "build_ball_backstop")
load("direct_trigger.star", "build_sear_hook", "build_sear_bracket", "build_stop_wedge", "stop_wedge_dims")

T_BOARD = 18.0
ZH = T_BOARD + 8.0 + 3.50
wx0, wx1, wh0, wh1 = stop_wedge_dims(ZH, T_BOARD)

bracket_pl = build_sear_bracket(name="bracket_raw").translate((0.0, 0.0, 0.0), name="mtc180_sear_bracket")
hook_pl = build_sear_hook(name="hook_raw").translate((52.0, -10.0, 0.0), name="mtc180_sear_hook")
wedge_pl = build_stop_wedge(wx1 - wx0, wh0, wh1, name="wedge_raw").translate((-10.0, 45.0, 0.0), name="mtc180_stop_wedge")
backstop_pl = build_ball_backstop(name="backstop_raw").translate((45.0, 55.0, 0.0), name="mtc180_ball_backstop")
kit = [bracket_pl, hook_pl, wedge_pl, backstop_pl]

export(kit, "mtc180_direct_kit.stl", tolerance=0.01)
export(kit, "mtc180_direct_kit_h2s.3mf", flavor=flavor.bambu, plate="MTC-180 Direct-Drive Sear, Stop and Backstop Kit (H2S)", name="mtc180_direct_kit", printer="bambu_h2s")
plate_images("mtc180_direct_kit_h2s.3mf", background="studio")

dwg = drawing(
    kit, view="three-view", sheet="A3", scale="1:1", hidden="dashed", units="mm",
    title="MTC-180 Direct-Drive Kit: Hook Sear, Clevis Bracket, Stop Wedge, Ball Backstop (1:1)",
    name="direct_kit_sheet",
)
export_pdf(dwg, "mtc180_direct_kit_drawing.pdf")
export_svg(dwg, "mtc180_direct_kit_drawing.svg")


def verify_direct_kit():
    tot = 0.0
    for p in kit:
        assert_solid(p)
        assert_printable(p, printer="bambu_h2s", nozzle=0.4, layer_height=0.28, max_overhang=46)
        assert_printable(p, printer="bambu_h2s", nozzle=0.6, layer_height=0.40, max_overhang=46)
        assert_printable(p, printer="bambu_h2s", nozzle=0.8, layer_height=0.44, max_overhang=46)
        tot += p.volume()
    for i in range(len(kit)):
        for j in range(i + 1, len(kit)):
            d = distance(kit[i], kit[j])
            assert_true(not d.overlap and d.distance > 4.0, msg="%s and %s are too close on the plate" % (kit[i].name, kit[j].name))
    return tot


test("direct-drive kit: four parts pass H2S 0.4/0.6/0.8 printability and do not touch on the plate", verify_direct_kit)
