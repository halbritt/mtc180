# Standalone Bambu Lab H2S Print Layout & Multi-Nozzle Test for MTC-180 v5 Stanchion + Gravity Sear + Roller Kit
load("stanchion_trigger.star", "build_stanchion_cheek", "build_trigger_and_rollers")

cheek_l = build_stanchion_cheek(side=1, name="stanchion_left_raw").translate((50.0, 5.0, 0.0), name="mtc180_stanchion_left")
cheek_r = build_stanchion_cheek(side=-1, name="stanchion_right_raw").translate((-50.0, -152.0, 0.0), name="mtc180_stanchion_right")
stop_sl, roller, pawl = build_trigger_and_rollers(prefix="kit")

stop_pl = stop_sl.translate((136.0, -25.0, 0.0), name="mtc180_stop_sleeve")
roller_pl = roller.translate((136.0, -62.0, 0.0), name="mtc180_cord_roller")
pawl_pl = pawl.translate((142.0, -108.0, 0.0), name="mtc180_gravity_sear")
kit = [cheek_l, cheek_r, stop_pl, roller_pl, pawl_pl]

export(kit, "mtc180_stanchion_kit.stl", tolerance=0.01)
export(kit, "mtc180_stanchion_kit_h2s.3mf", flavor=flavor.bambu, plate="MTC-180 v5 Floor-Flush Stanchion + Gravity Sear Kit (H2S)", name="mtc180_stanchion_kit", printer="bambu_h2s")
plate_images("mtc180_stanchion_kit_h2s.3mf", background="studio")

dwg = drawing(
    kit, view="three-view", sheet="A3", hidden="dashed", units="mm",
    title="MTC-180 v5 Floor-Flush Stanchions, 3-Angle CoP Stop Sleeve, M4 Cord Roller & Gravity Ratchet Sear",
    name="stanchion_kit_sheet",
)
export_pdf(dwg, "mtc180_stanchion_kit_drawing.pdf")
export_svg(dwg, "mtc180_stanchion_kit_drawing.svg")


def verify_stanchion_kit_h2s():
    tot = 0.0
    for p in kit:
        assert_solid(p)
        assert_printable(p, printer="bambu_h2s", nozzle=0.4, layer_height=0.28, max_overhang=46)
        assert_printable(p, printer="bambu_h2s", nozzle=0.6, layer_height=0.40, max_overhang=46)
        assert_printable(p, printer="bambu_h2s", nozzle=0.8, layer_height=0.44, max_overhang=46)
        tot += p.volume()
    for i in range(len(kit)):
        for j in range(i + 1, len(kit)):
            assert_true(not distance(kit[i], kit[j]).overlap, msg="%s overlaps %s on build plate" % (kit[i].name, kit[j].name))
    return tot


test("stanchion + gravity sear + roller kit passes H2S 0.4, 0.6 TC, and 0.8 TC printability", verify_stanchion_kit_h2s)
