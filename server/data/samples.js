// Sample snippets designed to OVERLAP, so inserting them one after another
// builds a single connected graph (not isolated islands). The `shares` note
// tells you which entity should link to a previously-inserted snippet, and by
// which matching heuristic.
//
// Suggested order: insert top to bottom and watch the clusters connect.

export const SAMPLES = [
  {
    id: "curie",
    title: "Marie Curie",
    shares: "seeds the science cluster",
    text:
      "Marie Curie was a physicist born in Warsaw, Poland, in 1867. She discovered " +
      "the elements polonium and radium. In 1903 she won the Nobel Prize in Physics " +
      "together with her husband Pierre Curie. She later worked at the University of Paris.",
  },
  {
    id: "einstein",
    title: "Albert Einstein",
    shares: "“Nobel Prize in Physics” (exact) → links to Curie",
    text:
      "Albert Einstein was a physicist born in Ulm, Germany, in 1879. He developed the " +
      "theory of relativity and won the Nobel Prize in Physics in 1921. He worked at " +
      "Princeton University in the United States.",
  },
  {
    id: "apple",
    title: "Apple Inc.",
    shares: "seeds the tech cluster",
    text:
      "Apple Inc. was founded in 1976 by Steve Jobs and Steve Wozniak in Cupertino, " +
      "California. The company released the iPhone in 2007.",
  },
  {
    id: "pixar",
    title: "Pixar",
    shares: "“Steve Jobs” (exact) → links to Apple",
    text:
      "Steve Jobs acquired Pixar in 1986 and served as its chief executive. Pixar " +
      "produced the animated film Toy Story, which was released in 1995.",
  },
  {
    id: "cook",
    title: "Tim Cook",
    shares: "“Apple” ≈ “Apple Inc.” (normalized short-form) → links to Apple",
    text:
      "Tim Cook is the chief executive of Apple. Before joining Apple, he worked at " +
      "Compaq and IBM. Under Cook, Apple released the Apple Watch.",
  },
];
