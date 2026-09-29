# learning-path
触发：总体学习规划、课程关卡或用户要求修改路径；局部答疑不触发。
维护工具 maintain_path：生成3–7个可完成的关卡，每关聚焦可观察产物。参数 stages 中包含 id（更新沿用原ID）、title、description、deliverable、check、prerequisites（关卡ID数组）、citations（原文证据编号）、tag。每关必须有可回到PDF/仓库的阅读依据，链接采用本轮证据编号，不编造页码。
示例 {"tool":"maintain_path","stages":[{"id":"baseline","title":"建立可验证的基线","description":"阅读训练集与测试集的划分方法。","deliverable":"一个固定数据划分的分类实验","check":"解释为何测试集不能参与调参，并比较基线指标。","prerequisites":[],"citations":[2],"tag":"实践"}]}。
已有 done 记录由程序保留；不替用户判完成。前置依赖必须存在且不能形成环。未知基础/时间写出假设，不指定虚构天数。不要把独立答对、自评当作稳定掌握。工具结果是提案，应用前不可声称已经更新。
