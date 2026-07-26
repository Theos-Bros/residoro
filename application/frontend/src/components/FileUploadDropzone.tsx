import { useRef, useState } from 'react';

type Props = {
  onFileSelected: (file: File) => void;
  disabled?: boolean;
  label?: string;
  /** Defaults preserve the CSV migration flow's original behavior exactly. */
  accept?: string;
  maxSizeMb?: number;
  helperText?: string;
  multiple?: boolean;
};

// tb-properties-photos-001: generalized from a CSV-only dropzone (accept,
// maxSizeMb, helperText, multiple are new) so property photo upload can
// reuse it -- ClientMigration.tsx's existing call site passes none of the
// new props, so it keeps today's exact CSV behavior unchanged.
export function FileUploadDropzone({
  onFileSelected,
  disabled,
  label = 'property',
  accept = '.csv',
  maxSizeMb = 10,
  helperText,
  multiple = false,
}: Props) {
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleFiles(files: FileList | null) {
    if (!files) return;
    for (const file of Array.from(files)) {
      onFileSelected(file);
      if (!multiple) break;
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    handleFiles(e.dataTransfer.files);
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
      className={`rounded-lg border-2 p-8 text-center transition-colors ${
        isDragging ? 'border-solid border-primary bg-accent' : 'border-dashed border-input'
      } ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:bg-accent'}`}
    >
      <p className="text-sm text-foreground">
        {helperText ?? `Drag and drop your ${label} CSV here, or click to choose a file.`}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">Max {maxSizeMb} MB{accept === '.csv' ? ', up to 10,000 rows.' : '.'}</p>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        disabled={disabled}
        className="hidden"
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = '';
        }}
      />
    </div>
  );
}
