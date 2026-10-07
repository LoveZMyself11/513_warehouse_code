import { useState } from "react";
import { createPortal } from "react-dom";
import { Code2, ExternalLink, Mail, X } from "lucide-react";

export default function DeveloperContact({ onOpen }: { onOpen?: () => void }) {
  const [open, setOpen] = useState(false);
  const subject = encodeURIComponent("513仓库技术支持工单");
  const body = encodeURIComponent("部门：\n姓名：\n学号：\n遇到的问题：\n发生时间：\n复现步骤：\n\n请附上问题截图。");
  return <>
    <button className="developer-link" onClick={() => { setOpen(true); onOpen?.(); }}><Code2 size={14} />联系开发者</button>
    {open && createPortal(<div className="modal-layer" onMouseDown={(event) => event.target === event.currentTarget && setOpen(false)}>
      <section className="modal developer-modal" role="dialog" aria-modal="true" aria-labelledby="developer-title">
        <header><div><p className="eyebrow">513 仓库 · 开源项目</p><h2 id="developer-title">联系开发者</h2></div><button className="icon-button" onClick={() => setOpen(false)} aria-label="关闭"><X size={20} /></button></header>
        <div className="developer-content">
          <div className="developer-profile"><img src={`${import.meta.env.BASE_URL}developer-avatar.jpg`} alt="李在明的头像" /><div><strong>李在明（Love_ZMyself）</strong><span>计算机应用技术 2406 班</span></div></div>
          <p className="developer-motto">平静 坚毅 不流泪</p>
          <dl className="developer-contacts"><div><dt>WeChat</dt><dd>Love_ZMyself</dd></div><div><dt>QQ</dt><dd>2944095143</dd></div><div><dt>Email</dt><dd><a href="mailto:lovezmyself0511@gmail.com">lovezmyself0511@gmail.com</a></dd></div></dl>
          <p className="developer-support">如遇技术问题需要支持，建议通过邮箱发送工单，详细描述“XX 部门 XXX 遇到了什么问题”，并附上问题截图。</p>
          <div className="developer-actions"><a className="primary-button" href={`mailto:lovezmyself0511@gmail.com?subject=${subject}&body=${body}`}><Mail size={16} />发送工单</a><a className="secondary-button" href="https://github.com/LoveZMyself11/513_warehouse_code" target="_blank" rel="noreferrer"><Code2 size={16} />GitHub<ExternalLink size={14} /></a></div>
        </div>
      </section>
    </div>, document.body)}
  </>;
}
