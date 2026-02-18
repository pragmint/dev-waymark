type MarkdownRendererProps = {
  content: string | null;
};

export const MarkdownRenderer = ({ content }: MarkdownRendererProps) => (
  <>{content && <div class="markdown-content" dangerouslySetInnerHTML={{ __html: content }} />}</>
);
