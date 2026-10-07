const icpRecordUrl = "https://beian.miit.gov.cn/";
const publicSecurityRecordUrl = "https://www.beian.gov.cn/portal/registerSystemInfo?recordcode=33078202003351";

export default function LegalFooter() {
  return (
    <footer className="legal-footer" aria-label="备案与版权信息">
      <span>© 2026 义乌市意腾软件开发有限公司 版权所有</span>
      <span>最终解释权归义乌市意腾软件开发有限公司所有</span>
      <a href={icpRecordUrl} target="_blank" rel="noreferrer">浙ICP备2026022644号-1</a>
      <a href={publicSecurityRecordUrl} target="_blank" rel="noreferrer">浙公网安备33078202003351号</a>
    </footer>
  );
}
