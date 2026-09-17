import React from "react";

function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let i = 0;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }
    const token = match[0];
    if (token.startsWith("**") && token.endsWith("**") && token.length > 4) {
      nodes.push(<strong key={`${keyPrefix}-b-${i}`} className="font-semibold text-white">{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("`") && token.endsWith("`") && token.length > 2) {
      nodes.push(
        <code key={`${keyPrefix}-c-${i}`} className="bg-slate-800 border border-slate-700 rounded px-1 py-0.5 font-mono text-[11px] text-emerald-300">
          {token.slice(1, -1)}
        </code>
      );
    } else if (token.startsWith("*") && token.endsWith("*") && token.length > 2) {
      nodes.push(<em key={`${keyPrefix}-i-${i}`}>{token.slice(1, -1)}</em>);
    } else {
      nodes.push(token);
    }
    lastIndex = match.index + token.length;
    i += 1;
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

/**
 * Minimal, dependency-free Markdown renderer for AI-generated RFI clarifications.
 * Renders to React elements only (never dangerouslySetInnerHTML), so untrusted
 * model output cannot inject markup.
 */
export const MarkdownLite: React.FC<{ text: string; className?: string }> = ({ text, className }) => {
  if (!text) return null;
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: React.ReactNode[] = [];
  let listBuffer: string[] = [];
  let listOrdered = false;

  const flushList = (key: string) => {
    if (listBuffer.length === 0) return;
    const items = listBuffer.map((item, idx) => (
      <li key={`${key}-li-${idx}`} className="ml-4 list-outside leading-relaxed">
        {renderInline(item, `${key}-li-${idx}`)}
      </li>
    ));
    blocks.push(
      listOrdered ? (
        <ol key={key} className="space-y-0.5 list-decimal list-inside marker:text-slate-400">{items}</ol>
      ) : (
        <ul key={key} className="space-y-0.5 list-disc list-inside marker:text-slate-400">{items}</ul>
      )
    );
    listBuffer = [];
  };

  lines.forEach((rawLine, idx) => {
    const key = `md-${idx}`;
    const line = rawLine.trimEnd();
    if (!line.trim()) {
      flushList(`${key}-break`);
      return;
    }
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flushList(`${key}-h`);
      const level = heading[1].length;
      const content = renderInline(heading[2].trim(), key);
      if (level <= 1) {
        blocks.push(<h3 key={key} className="text-sm font-bold text-white mt-2">{content}</h3>);
      } else if (level === 2) {
        blocks.push(<h4 key={key} className="text-xs font-bold text-sky-300 mt-2 uppercase tracking-wide">{content}</h4>);
      } else {
        blocks.push(<h5 key={key} className="text-xs font-bold text-slate-200 mt-1.5">{content}</h5>);
      }
      return;
    }
    if (/^(\*\s*\*\s*\*|---|___|━+)$/.test(line.trim()) || /^-{3,}$/.test(line.trim())) {
      flushList(`${key}-hr`);
      blocks.push(<hr key={key} className="border-slate-800 my-2" />);
      return;
    }
    const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
    if (bullet) {
      if (listOrdered && listBuffer.length > 0) flushList(`${key}-ob`);
      listOrdered = false;
      listBuffer.push(bullet[1]);
      return;
    }
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (numbered) {
      if (!listOrdered && listBuffer.length > 0) flushList(`${key}-ub`);
      listOrdered = true;
      listBuffer.push(numbered[1]);
      return;
    }
    flushList(`${key}-p`);
    blocks.push(
      <p key={key} className="leading-relaxed">
        {renderInline(line, key)}
      </p>
    );
  });
  flushList("md-tail");

  return <div className={className ?? "space-y-1.5"}>{blocks}</div>;
};