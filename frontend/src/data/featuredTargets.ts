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
    note: "Named science target; no matching local SPHEREx observation is cached yet.",
    coordinates: null,
    ra: null,
    dec: null,
    source: "User-provided target list; coordinates require archive/catalog verification.",
  },
  {
    name: "Epsilon Indi Ba/Bb",
    type: "Brown-dwarf pair",
    note: "Named science target; no matching local SPHEREx observation is cached yet.",
    coordinates: null,
    ra: null,
    dec: null,
    source: "User-provided target list; coordinates require archive/catalog verification.",
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
    note: "Named science target; no matching local SPHEREx observation is cached yet.",
    coordinates: null,
    ra: null,
    dec: null,
    source: "User-provided target list; coordinates require archive/catalog verification.",
  },
  {
    name: "R Draconis",
    type: "Variable star",
    note: "Named science target; no matching local SPHEREx observation is cached yet.",
    coordinates: null,
    ra: null,
    dec: null,
    source: "User-provided target list; coordinates require archive/catalog verification.",
  },
];
