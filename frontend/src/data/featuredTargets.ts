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
    note: "The fastest-moving star in the night sky. Blink between dates and watch it drift.",
    coordinates: "17h57m48.5s, +04d41m36s",
    ra: 269.454,
    dec: 4.693,
    source: "SIMBAD J2000 coordinates.",
  },
  {
    name: "Epsilon Indi Ba/Bb",
    type: "Brown-dwarf pair",
    note: "A nearby star orbited by two brown dwarfs - 'failed stars' that glow only in infrared.",
    coordinates: "22h03m21.7s, -56d47m09s",
    ra: 330.84,
    dec: -56.786,
    source: "SIMBAD J2000 coordinates.",
  },
  {
    name: "WISE 0855",
    type: "Fast-moving brown dwarf",
    note: "The coldest known brown dwarf and one of our nearest neighbors. Only the longest-wavelength detectors can see it.",
    coordinates: "08h55m10.831s, -07d14m42.53s",
    ra: 133.795129,
    dec: -7.245147,
    source: "User-provided target list.",
  },
  {
    name: "RW Aurigae",
    type: "Variable star",
    note: "A young star that brightens and fades as it feeds on its planet-forming disk.",
    coordinates: "05h07m49.6s, +30d24m05s",
    ra: 76.957,
    dec: 30.401,
    source: "SIMBAD J2000 coordinates.",
  },
  {
    name: "R Draconis",
    type: "Variable star",
    note: "A pulsing red giant that swells and dims dramatically on an eight-month cycle.",
    coordinates: "16h32m40.2s, +66d45m18s",
    ra: 248.168,
    dec: 66.755,
    source: "SIMBAD J2000 coordinates.",
  },
];
