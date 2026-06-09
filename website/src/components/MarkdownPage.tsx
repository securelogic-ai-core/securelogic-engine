import ReactMarkdown, { type Components } from "react-markdown";
import type { PluggableList } from "unified";
import remarkGfm from "remark-gfm";
import rehypeSlug from "rehype-slug";
import rehypeAutolinkHeadings from "rehype-autolink-headings";
import GithubSlugger from "github-slugger";

// hast node shape (minimal — avoids pulling in @types/hast).
interface HastNode {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

function headingText(node: HastNode): string {
  if (node.type === "text") return node.value ?? "";
  return (node.children ?? []).map(headingText).join("");
}

// The legal docs use numbered headings ("## 1. Acceptance of Terms") but their
// table-of-contents links target the un-numbered slug ("#acceptance-of-terms").
// rehype-slug would derive "1-acceptance-of-terms" and the anchors would break.
// This plugin strips the leading section number, then slugs with github-slugger
// (GitHub's own algorithm, matching the authored TOC) so the anchors resolve.
// It runs before rehype-slug, which then only fills in any heading we skipped.
function rehypeNumberedSlugs() {
  return (tree: HastNode) => {
    const slugger = new GithubSlugger();
    const visit = (node: HastNode) => {
      if (node.type === "element" && node.tagName && /^h[1-6]$/.test(node.tagName)) {
        const stripped = headingText(node).replace(/^\s*\d+(\.\d+)*\.?\s+/, "");
        const slug = slugger.slug(stripped);
        if (slug) {
          node.properties = node.properties ?? {};
          if (!node.properties.id) node.properties.id = slug;
        }
      }
      (node.children ?? []).forEach(visit);
    };
    visit(tree);
  };
}

interface MarkdownPageProps {
  title: string;
  eyebrow: string;
  content: string;
  effectiveDate?: string;
  lastUpdated?: string;
}

// The navy hero renders the document title and the effective/last-updated line,
// so we strip the markdown body's own leading `# Title` heading and the
// `**Version … | Effective … **` chrome line to avoid showing them twice.
// The source markdown is unchanged; this only affects on-page rendering.
function stripLeadingTitle(markdown: string): string {
  const lines = markdown.split("\n");
  let i = 0;
  while (i < lines.length && lines[i].trim() === "") i++;
  if (i < lines.length && /^#\s+/.test(lines[i])) {
    i++;
    while (i < lines.length && lines[i].trim() === "") i++;
    if (i < lines.length && /^\*\*Version/.test(lines[i].trim())) {
      i++;
    }
  }
  return lines.slice(i).join("\n");
}

const markdownComponents: Components = {
  h1: ({ children }) => (
    <h1 className="text-3xl font-bold text-navy-900 mt-12 mb-4">{children}</h1>
  ),
  h2: ({ children, id }) => (
    <h2 id={id} className="text-3xl font-bold text-navy-900 mt-12 mb-4 scroll-mt-24">
      {children}
    </h2>
  ),
  h3: ({ children, id }) => (
    <h3 id={id} className="text-xl font-semibold text-navy-900 mt-8 mb-3 scroll-mt-24">
      {children}
    </h3>
  ),
  p: ({ children }) => <p className="text-slate-700 leading-relaxed my-4">{children}</p>,
  ul: ({ children }) => <ul className="list-disc pl-6 my-4 space-y-1">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal pl-6 my-4 space-y-1">{children}</ol>,
  li: ({ children }) => <li className="mb-2 text-slate-700 leading-relaxed">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold text-navy-900">{children}</strong>,
  table: ({ children }) => (
    <div className="overflow-x-auto">
      <table className="border-collapse w-full my-6 border border-slate-200 text-sm">
        {children}
      </table>
    </div>
  ),
  th: ({ children }) => (
    <th className="bg-slate-50 p-3 text-left font-semibold border-b border-slate-200 text-navy-900 align-top">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="p-3 border-b border-slate-200 text-slate-700 align-top">{children}</td>
  ),
  blockquote: ({ children }) => (
    <blockquote className="border-l-4 border-teal-600 pl-4 italic text-slate-600 my-4">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-8 border-slate-200" />,
  a: ({ href, children, className }) => {
    // Heading self-links injected by rehype-autolink-headings (behavior: "wrap")
    // should not pick up the teal/underline link styling — keep heading text plain.
    if (typeof className === "string" && className.includes("heading-link")) {
      return (
        <a href={href} className="no-underline text-inherit hover:text-teal-700 transition-colors">
          {children}
        </a>
      );
    }
    return (
      <a href={href} className="text-teal-600 hover:text-teal-700 underline">
        {children}
      </a>
    );
  },
};

export function MarkdownPage({
  title,
  eyebrow,
  content,
  effectiveDate,
  lastUpdated,
}: MarkdownPageProps) {
  const body = stripLeadingTitle(content);

  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden bg-navy-900 border-b border-slate-800 pt-20 pb-20 px-4 text-center">
        <div
          className="absolute inset-0 pointer-events-none"
          aria-hidden="true"
          style={{
            background:
              "radial-gradient(ellipse 60% 80% at 50% 120%, rgba(13,148,136,0.13) 0%, transparent 65%)",
          }}
        />
        <div className="relative max-w-3xl mx-auto">
          <p className="text-xs font-bold text-teal-400 uppercase tracking-widest mb-4">
            {eyebrow}
          </p>
          <h1 className="text-4xl font-bold text-white mb-4">{title}</h1>
          {(effectiveDate || lastUpdated) && (
            <p className="text-sm text-slate-400">
              {effectiveDate && <>Effective {effectiveDate}</>}
              {effectiveDate && lastUpdated && <> &middot; </>}
              {lastUpdated && <>Last updated {lastUpdated}</>}
            </p>
          )}
        </div>
      </section>

      {/* Body */}
      <section className="py-16 px-4">
        <div className="max-w-4xl mx-auto">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={
              [
                rehypeNumberedSlugs,
                rehypeSlug,
                [rehypeAutolinkHeadings, { behavior: "wrap", properties: { className: ["heading-link"] } }],
              ] as PluggableList
            }
            components={markdownComponents}
          >
            {body}
          </ReactMarkdown>
        </div>
      </section>
    </>
  );
}
