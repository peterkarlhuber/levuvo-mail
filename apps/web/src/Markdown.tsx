// A small, safe Markdown renderer for answers of the assistant: paragraphs, line breaks, "- " and
// "1. " lists, **bold**, *italic* and `code`. It builds React elements only and never sets HTML, so
// text from a model (which may echo mail content) cannot inject markup. Headings are shown as bold
// lines; links, images and tables are shown as plain text.
import { Fragment } from 'react';
import { inlineTokens, parseBlocks } from './markdown-parse';

function inline(text: string, keyBase: string) {
  return inlineTokens(text).map((tok, n) => {
    const key = `${keyBase}-${n}`;
    if (tok.kind === 'strong') return <strong key={key}>{tok.text}</strong>;
    if (tok.kind === 'em') return <em key={key}>{tok.text}</em>;
    if (tok.kind === 'code') return <code key={key}>{tok.text}</code>;
    return <Fragment key={key}>{tok.text}</Fragment>;
  });
}

function lines(text: string, keyBase: string) {
  return text.split('\n').map((line, i) => (
    <Fragment key={`${keyBase}-${i}`}>
      {i > 0 && <br />}
      {inline(line, `${keyBase}-${i}`)}
    </Fragment>
  ));
}

export function Markdown({ text, className }: { text: string; className?: string }) {
  const blocks = parseBlocks(text);
  return (
    <div className={['markdown', className].filter(Boolean).join(' ')}>
      {blocks.map((b, i) => {
        if (b.kind === 'p') return <p key={i}>{lines(b.lines.join('\n'), `p${i}`)}</p>;
        const Tag = b.kind;
        return (
          <Tag key={i}>
            {b.items.map((item, j) => (
              <li key={j}>{lines(item, `l${i}-${j}`)}</li>
            ))}
          </Tag>
        );
      })}
    </div>
  );
}
