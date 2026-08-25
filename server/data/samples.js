// Sample snippets designed to OVERLAP, so inserting them one after another
// builds a single connected graph (not isolated islands). The `shares` note
// tells you which entity should link to a previously-inserted snippet, and by
// which matching heuristic.
//
// Suggested order: insert top to bottom and watch the clusters connect.
// 示例片段设计为相互重叠，因此按顺序插入它们可以构建一个连接的图谱（而不是孤立的岛屿）。
// `shares` 注释说明了哪个实体应该链接到之前插入的片段，以及通过哪种匹配启发式方法。
//
// 建议顺序：从上到下插入，观察集群连接。

export const SAMPLES = [
  {
    id: "curie",
    title: "玛丽·居里",
    shares: "启动科学集群",
    text:
      "玛丽·居里是一位物理学家，1867 年出生于波兰华沙。她发现了钋和镭元素。" +
      "1903 年，她与丈夫皮埃尔·居里共同获得了诺贝尔物理学奖。她后来在巴黎大学工作。",
  },
  {
    id: "einstein",
    title: "阿尔伯特·爱因斯坦",
    shares: ""诺贝尔物理学奖"（完全匹配）→ 链接到居里",
    text:
      "阿尔伯特·爱因斯坦是一位物理学家，1879 年出生于德国乌尔姆。他提出了相对论，" +
      "并于 1921 年获得诺贝尔物理学奖。他曾在美国普林斯顿大学工作。",
  },
  {
    id: "apple",
    title: "苹果公司",
    shares: "启动科技集群",
    text:
      "苹果公司由史蒂夫·乔布斯和史蒂夫·沃兹尼亚克于 1976 年在加利福尼亚州库比蒂诺创立。" +
      "该公司于 2007 年发布了 iPhone。",
  },
  {
    id: "pixar",
    title: "皮克斯",
    shares: ""史蒂夫·乔布斯"（完全匹配）→ 链接到苹果",
    text:
      "史蒂夫·乔布斯于 1986 年收购了皮克斯并担任其首席执行官。皮克斯制作了动画电影《玩具总动员》，" +
      "该片于 1995 年上映。",
  },
  {
    id: "cook",
    title: "蒂姆·库克",
    shares: ""苹果" ≈ "苹果公司"（规范化简称）→ 链接到苹果",
    text:
      "蒂姆·库克是苹果公司的首席执行官。在加入苹果之前，他曾在康柏和 IBM 工作。" +
      "在库克的领导下，苹果发布了 Apple Watch。",
  },
];
