import { useRef, useState } from 'react';

type Props = {
  onFileSelected: (file: File) => void;
  disabled?: boolean;
  label?: string;
};

export function FileUploadDropzone({ onFileSelected, disabled, label = 'property' }: Props) {
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) onFileSelected(file);
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
      className={`rounded-md border-2 p-8 text-center transition-colors ${
        isDragging ? 'border-solid border-primary bg-accent' : 'border-dashed border-input'
      } ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:bg-accent'}`}
    >
      <p className="text-sm text-foreground">Drag and drop your {label} CSV here, or click to choose a file.</p>
      <p className="mt-1 text-xs text-muted-foreground">Max 10 MB, up to 10,000 rows.</p>
      <input
        ref={inputRef}
        type="file"
        accept=".csv"
        disabled={disabled}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFileSelected(file);
          e.target.value = '';
        }}
      />
    </div>
  );
}
