import { useEffect } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { cn } from '@/lib/utils';

type Props = {
  value: string;
  onChange?: (html: string) => void;
  editable?: boolean;
  className?: string;
  placeholder?: string;
};

// tb-distribution-share-text-001: first rich-text editor in this codebase
// (TipTap + StarterKit) -- used both for brokerage-authored templates
// (Settings) and the editable share-text preview (Share Details modal).
// Emoji need no special extension -- they're plain Unicode characters any
// OS/keyboard emoji picker inserts into a normal text node.
export function RichTextEditor({ value, onChange, editable = true, className, placeholder }: Props) {
  const editor = useEditor({
    extensions: [StarterKit],
    content: value,
    editable,
    onUpdate: ({ editor }) => onChange?.(editor.getHTML()),
  });

  useEffect(() => {
    if (editor && value !== editor.getHTML()) {
      editor.commands.setContent(value, { emitUpdate: false });
    }
  }, [value, editor]);

  useEffect(() => {
    editor?.setEditable(editable);
  }, [editable, editor]);

  return (
    <EditorContent
      editor={editor}
      className={cn(
        'rounded-md border border-input bg-background px-3 py-2 text-sm',
        '[&_.ProseMirror]:min-h-24 [&_.ProseMirror]:outline-none',
        '[&_.ProseMirror_ul]:list-disc [&_.ProseMirror_ul]:pl-5 [&_.ProseMirror_ol]:list-decimal [&_.ProseMirror_ol]:pl-5',
        '[&_.ProseMirror_p]:my-1',
        className,
      )}
      data-placeholder={placeholder}
    />
  );
}
