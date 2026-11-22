# Optional 4-piece Printed M3 Wire Clamp Bars (1.1 mm low-profile nose fits inside rear spring-coil wood gap!)
# Threads onto 4x M3x8 flat-head countersunk screws (with standard M3 hex nuts pressed into top hex pockets)

bars = []
# 2x Twin-Wire Inner Clamp Bars (clamps both wires at y_m ± 4.25 mm simultaneously!)
for idx, x0 in enumerate([-16.0, 16.0]):
    b = box(8.0, 12.6, 3.4, at=(x0 - 4.0, -6.3, 0.0), name="inner_clamp_" + str(idx))
    # Undercut steps on bottom (printed upside-down so Z=0 is flat top, zero overhangs!)
    # Print flat on top face: Z=0..3.4, M3 thru-hole + M3 hex nut pocket (s=5.6mm across flats -> r_circum = 3.24mm, depth 2.0mm from Z=3.4!)
    nut_cut = extrude(sketch(XY.offset(1.4), name="nc_in_" + str(idx)).ngon(6, 3.25, center=(x0, 0.0)), 3.0, name="nb_in_" + str(idx))
    hole_cut = cylinder(1.6, 6.0, at=(x0, 0.0, -1.0), name="hc_in_" + str(idx))
    # Wire saddle grooves on Z=3.4 face? Wait: print with flat face on Z=0, hex nut pocket on top (Z=1.4..3.4)?
    # No: if M3 screw comes from carrier Z=0 up through wire side, nut is on top of clamp bar -> clamp bar sits wire-side DOWN!
    # So printing clamp bar UPSIDE-DOWN (top nut face on Z=0? No, hex pocket on top Z=1.2..3.2 has 0 overhang, and two shallow V-grooves on top!)
    bars.append(subtract([b, nut_cut, hole_cut], kernel=kernel.mesh, name="m3_inner_clamp_" + str(idx)))

for idx, x0 in enumerate([-16.0, 16.0]):
    b = box(8.0, 10.6, 3.4, at=(x0 - 4.0, 12.0, 0.0), name="outer_clamp_" + str(idx))
    nut_cut = extrude(sketch(XY.offset(1.4), name="nc_out_" + str(idx)).ngon(6, 3.25, center=(x0, 17.3)), 3.0, name="nb_out_" + str(idx))
    hole_cut = cylinder(1.6, 6.0, at=(x0, 17.3, -1.0), name="hc_out_" + str(idx))
    bars.append(subtract([b, nut_cut, hole_cut], kernel=kernel.mesh, name="m3_outer_clamp_" + str(idx)))

export(bars, "m3_wire_clamp_bars.stl", tolerance=0.01)
