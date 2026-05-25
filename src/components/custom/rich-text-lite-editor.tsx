'use client';

import { useCallback, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

type RichTextLiteEditorProps = {
  id?: string;
  label?: string;
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  className?: string;
};

export function RichTextLiteEditor({
  id,
  label,
  value,
  onChange,
  placeholder = '輸入公告文字…',
  className,
}: RichTextLiteEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    if (el.innerHTML !== value) {
      el.innerHTML = value;
    }
  }, [value]);

  const applyFormat = useCallback((command: 'bold' | 'italic' | 'underline') => {
    const el = editorRef.current;
    if (!el) return;
    el.focus();
    document.execCommand(command, false);
    onChange(el.innerHTML);
  }, [onChange]);

  const handleInput = () => {
    const el = editorRef.current;
    if (!el) return;
    onChange(el.innerHTML);
  };

  const inputId = id ?? 'rich-text-lite';

  return (
    <div className={cn('grid gap-2', className)}>
      {label ? <Label htmlFor={inputId}>{label}</Label> : null}
      <div className="flex gap-1 rounded-md border border-input bg-muted/40 p-1">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 min-w-8 px-2 font-bold"
          onClick={() => applyFormat('bold')}
          aria-label="加粗"
        >
          B
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 min-w-8 px-2 italic"
          onClick={() => applyFormat('italic')}
          aria-label="斜體"
        >
          /
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 min-w-8 px-2 underline"
          onClick={() => applyFormat('underline')}
          aria-label="底線"
        >
          _
        </Button>
      </div>
      <div
        id={inputId}
        ref={editorRef}
        role="textbox"
        aria-multiline="true"
        contentEditable
        suppressContentEditableWarning
        onInput={handleInput}
        data-placeholder={placeholder}
        className={cn(
          'min-h-[120px] rounded-md border border-input bg-background px-3 py-2 text-sm leading-relaxed',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          'empty:before:pointer-events-none empty:before:text-muted-foreground empty:before:content-[attr(data-placeholder)]',
          '[&_strong]:font-bold [&_b]:font-bold [&_em]:italic [&_i]:italic [&_u]:underline'
        )}
      />
      <p className="text-xs text-muted-foreground">
        支援加粗、斜體、底線，可組合使用。內容以 HTML 儲存，發布後由系統安全渲染。
      </p>
    </div>
  );
}
