// Small reusable circular avatar. Shows uploaded photo if present, else initials.
// Same visual language across sidebar, admin equipo list, and pedidos row.
export default function Avatar({ src, name = '', size = 32, className = '', testId }) {
  const initial = (name || '?').trim().charAt(0).toUpperCase() || '?';
  const style = { width: `${size}px`, height: `${size}px` };
  const fontSize = Math.round(size * 0.42);
  if (src) {
    return (
      <img
        src={src}
        alt={name}
        style={style}
        data-testid={testId}
        className={`rounded-full object-cover bg-[#F3EBE0] border border-[#501122]/10 ${className}`}
      />
    );
  }
  return (
    <div
      style={style}
      data-testid={testId}
      className={`rounded-full bg-[#F3EBE0] border border-[#501122]/10 flex items-center justify-center shrink-0 ${className}`}
    >
      <span className="font-heading text-[#501122]" style={{ fontSize: `${fontSize}px` }}>{initial}</span>
    </div>
  );
}
