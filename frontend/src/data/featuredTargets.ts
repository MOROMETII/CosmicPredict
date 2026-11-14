export type FeaturedTarget = {
  name: string;
  type: string;
  note: string;
  coordinates: string | null;
  ra: number | null;
  dec: number | null;
  source: string;
};

export const featuredTargets: FeaturedTarget[] = [
  {
    name: "Barnard's Star",
    type: "Nearby high-proper-motion star",
    note: "Nearby red dwarf with large proper motion.",
    coordinates: "17h57m48.5s, +04d41m36s",
    ra: 269.454,
    dec: 4.693,
    source: "SIMBAD J2000 coordinates.",
  },
  {
    name: "Epsilon Indi Ba/Bb",
    type: "Brown-dwarf pair",
    note: "Nearby brown-dwarf binary.",
    coordinates: "22h03m21.7s, -56d47m09s",
    ra: 330.84,
    dec: -56.786,
    source: "SIMBAD J2000 coordinates.",
  },
  {
    name: "WISE 0855",
    type: "Fast-moving brown dwarf",
    note: "Coordinate supplied in the project brief; archive coverage still needs to be queried.",
    coordinates: "08h55m10.831s, -07d14m42.53s",
    ra: 133.795129,
    dec: -7.245147,
    source: "User-provided target list.",
  },
  {
    name: "RW Aurigae",
    type: "Variable star",
    note: "Young variable star in the Taurus-Auriga region.",
    coordinates: "05h07m49.6s, +30d24m05s",
    ra: 76.957,
    dec: 30.401,
    source: "SIMBAD J2000 coordinates.",
  },
  {
    name: "R Draconis",
    type: "Variable star",
    note: "Long-period Mira variable.",
    coordinates: "17h29m15.9s, +66d00m00s",
    ra: 262.316,
    dec: 66.0,
    source: "SIMBAD J2000 coordinates.",
  },
];
