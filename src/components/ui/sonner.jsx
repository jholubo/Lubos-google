import { useTheme } from "next-themes"
import { Toaster as Sonner, toast } from "sonner"

const Toaster = ({
  ...props
}) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme}
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-[#501122] group-[.toaster]:text-white group-[.toaster]:border group-[.toaster]:border-white/15 group-[.toaster]:shadow-md group-[.toaster]:rounded-full group-[.toaster]:px-4 group-[.toaster]:py-2 group-[.toaster]:text-xs group-[.toaster]:font-semibold group-[.toaster]:flex group-[.toaster]:items-center group-[.toaster]:gap-2",
          title: "group-[.toast]:text-xs group-[.toast]:font-medium group-[.toast]:text-white group-[.toast]:leading-snug",
          description: "group-[.toast]:text-[11px] group-[.toast]:text-white/80 group-[.toast]:leading-tight",
          actionButton:
            "group-[.toast]:bg-white group-[.toast]:text-[#501122] group-[.toast]:font-bold group-[.toast]:rounded-full group-[.toast]:px-2.5 group-[.toast]:py-0.5 group-[.toast]:text-[10px]",
          cancelButton:
            "group-[.toast]:bg-white/20 group-[.toast]:text-white group-[.toast]:rounded-full group-[.toast]:px-2.5 group-[.toast]:py-0.5 group-[.toast]:text-[10px]",
          icon: "group-[.toast]:text-amber-300 group-[.toast]:shrink-0 group-[.toast]:w-4 group-[.toast]:h-4",
        },
      }}
      {...props} />
  );
}

export { Toaster, toast }

