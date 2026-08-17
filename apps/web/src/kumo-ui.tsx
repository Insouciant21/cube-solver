import {
  Badge as KumoBadge,
  Banner as KumoBanner,
  Button as KumoButton,
  Dialog as KumoDialog,
  Input as KumoInput,
  LinkButton as KumoLinkButton,
  Select as KumoSelect,
} from "@cloudflare/kumo";
import "@cloudflare/kumo/styles/standalone";
import { Children, createElement, forwardRef, isValidElement, useEffect, useMemo, type ElementType, type ReactNode } from "react";
import type * as React from "react";

export type SxProps = Record<string, unknown>;

type ResponsiveValue = string | number | null | undefined;
type AnyProps = Record<string, unknown>;

const BREAKPOINTS: Record<string, number> = {
  xs: 0,
  sm: 560,
  md: 821,
  lg: 1041,
  xl: 1920,
};

const SPACING_KEYS = new Set([
  "m", "mt", "mr", "mb", "ml", "mx", "my",
  "p", "pt", "pr", "pb", "pl", "px", "py",
  "gap", "rowGap", "columnGap",
]);

const PROPERTY_ALIASES: Record<string, string> = {
  bgcolor: "background-color",
  borderRadius: "border-radius",
  boxShadow: "box-shadow",
  columnGap: "column-gap",
  flexBasis: "flex-basis",
  flexDirection: "flex-direction",
  flexGrow: "flex-grow",
  flexShrink: "flex-shrink",
  fontFamily: "font-family",
  fontSize: "font-size",
  fontStyle: "font-style",
  fontVariantNumeric: "font-variant-numeric",
  fontWeight: "font-weight",
  gridArea: "grid-area",
  gridColumn: "grid-column",
  gridRow: "grid-row",
  gridTemplateAreas: "grid-template-areas",
  gridTemplateColumns: "grid-template-columns",
  gridTemplateRows: "grid-template-rows",
  letterSpacing: "letter-spacing",
  lineHeight: "line-height",
  maxHeight: "max-height",
  maxWidth: "max-width",
  minHeight: "min-height",
  minWidth: "min-width",
  objectFit: "object-fit",
  overflowWrap: "overflow-wrap",
  overscrollBehavior: "overscroll-behavior",
  paddingBottom: "padding-bottom",
  paddingLeft: "padding-left",
  paddingRight: "padding-right",
  paddingTop: "padding-top",
  placeContent: "place-content",
  placeItems: "place-items",
  pointerEvents: "pointer-events",
  rowGap: "row-gap",
  textAlign: "text-align",
  textDecoration: "text-decoration",
  textOverflow: "text-overflow",
  textTransform: "text-transform",
  WebkitOverflowScrolling: "-webkit-overflow-scrolling",
  whiteSpace: "white-space",
  zIndex: "z-index",
};

const TOKEN_VALUES: Record<string, string> = {
  "primary.main": "var(--color-kumo-brand, #2563eb)",
  "primary.contrastText": "#fff",
  "text.primary": "var(--text-color-kumo-default, #343438)",
  "text.secondary": "var(--text-color-kumo-subtle, #737373)",
  "background.paper": "var(--color-kumo-base, #fff)",
  "error.main": "var(--color-kumo-danger, #d92d20)",
  "success.main": "var(--color-kumo-success, #159570)",
  "warning.main": "var(--color-kumo-warning, #d58b16)",
};

function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  return `{${Object.keys(value as AnyProps).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize((value as AnyProps)[key])}`).join(",")}}`;
}

function hash(value: string): string {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(36);
}

function kebabCase(value: string): string {
  return value.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`);
}

function resolveToken(value: ResponsiveValue): string | number | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== "string") return value;
  return TOKEN_VALUES[value] ?? value;
}

function cssValue(key: string, value: ResponsiveValue): string | number | undefined {
  const resolved = resolveToken(value);
  if (resolved === undefined) return undefined;
  if (typeof resolved !== "number") return resolved;
  // These CSS properties accept unitless numeric values. Appending `px` to
  // line-height, font-weight, or flex values makes the declaration invalid
  // and is especially visible in compact formula rows.
  if (["lineHeight", "fontWeight", "opacity", "zIndex", "flexGrow", "flexShrink", "order"].includes(key)) return resolved;
  if (SPACING_KEYS.has(key)) return `${resolved * 8}px`;
  if (key === "borderRadius") return `${resolved * 4}px`;
  return `${resolved}px`;
}

const SPACING_DECLARATIONS: Record<string, string[]> = {
  m: ["margin"],
  mt: ["margin-top"],
  mr: ["margin-right"],
  mb: ["margin-bottom"],
  ml: ["margin-left"],
  mx: ["margin-left", "margin-right"],
  my: ["margin-top", "margin-bottom"],
  p: ["padding"],
  pt: ["padding-top"],
  pr: ["padding-right"],
  pb: ["padding-bottom"],
  pl: ["padding-left"],
  px: ["padding-left", "padding-right"],
  py: ["padding-top", "padding-bottom"],
};

function cssDeclarations(key: string, value: ResponsiveValue): string[] {
  const resolved = cssValue(key, value);
  if (resolved === undefined) return [];
  const properties = SPACING_DECLARATIONS[key] ?? [PROPERTY_ALIASES[key] ?? kebabCase(key)];
  return properties.map((property) => `${property}:${resolved};`);
}

function mediaQuery(key: string): string | null {
  if (key.startsWith("@media")) return key.slice(6).trim();
  if (key in BREAKPOINTS && BREAKPOINTS[key] > 0) return `(min-width: ${BREAKPOINTS[key]}px)`;
  return null;
}

function addDeclarations(selector: string, values: AnyProps, rules: string[], media?: string): void {
  const declarations: string[] = [];
  const responsiveRules: Array<{ key: string; value: ResponsiveValue; media: string }> = [];
  for (const [key, rawValue] of Object.entries(values)) {
    if (key.startsWith("&") || key.startsWith("@media") || key in BREAKPOINTS) continue;
    if (rawValue && typeof rawValue === "object" && !Array.isArray(rawValue)) {
      const responsiveValues = rawValue as AnyProps;
      for (const [responsiveKey, responsiveValue] of Object.entries(responsiveValues)) {
        const responsiveMedia = mediaQuery(responsiveKey);
        if (responsiveMedia) {
          responsiveRules.push({ key, value: responsiveValue as ResponsiveValue, media: responsiveMedia });
        } else if (responsiveKey === "xs") {
          declarations.push(...cssDeclarations(key, responsiveValue as ResponsiveValue));
        }
      }
      continue;
    }
    declarations.push(...cssDeclarations(key, rawValue as ResponsiveValue));
  }
  if (declarations.length) {
    const rule = `${selector}{${declarations.join("")}}`;
    rules.push(media ? `@media ${media}{${rule}}` : rule);
  }
  for (const responsiveRule of responsiveRules) {
    addDeclarations(selector, { [responsiveRule.key]: responsiveRule.value }, rules, responsiveRule.media);
  }
}

function buildSxRules(selector: string, values: AnyProps, rules: string[], media?: string): void {
  addDeclarations(selector, values, rules, media);
  for (const [key, rawValue] of Object.entries(values)) {
    if (key.startsWith("&")) {
      if (!rawValue || typeof rawValue !== "object" || Array.isArray(rawValue)) continue;
      buildSxRules(key.replaceAll("&", selector), rawValue as AnyProps, rules, media);
      continue;
    }
    const nextMedia = mediaQuery(key);
    if (nextMedia && rawValue && typeof rawValue === "object" && !Array.isArray(rawValue)) {
      buildSxRules(selector, rawValue as AnyProps, rules, nextMedia);
    }
  }
}

const registeredSx = new Set<string>();

function sxClassName(sx: SxProps | undefined): string | undefined {
  if (!sx || Object.keys(sx).length === 0) return undefined;
  const serialized = stableSerialize(sx);
  const className = `kumo-sx-${hash(serialized)}`;
  if (typeof document !== "undefined" && !registeredSx.has(className)) {
    const rules: string[] = [];
    buildSxRules(`.${className}`, sx, rules);
    const style = document.createElement("style");
    style.dataset.kumoSx = className;
    style.textContent = rules.join("");
    document.head.appendChild(style);
    registeredSx.add(className);
  }
  return className;
}

function joinClasses(...values: Array<string | false | null | undefined>): string | undefined {
  const result = values.filter(Boolean).join(" ");
  return result || undefined;
}

type LayoutProps = Omit<React.HTMLAttributes<HTMLElement>, "children"> & {
  component?: ElementType;
  className?: string;
  sx?: SxProps;
  children?: ReactNode;
  htmlFor?: string;
  href?: string;
};

export const Box = forwardRef<HTMLElement, LayoutProps>(function Box(input, ref) {
  const component = (input.component ?? "div") as ElementType;
  const className = input.className as string | undefined;
  const sx = input.sx as SxProps | undefined;
  const children = input.children as ReactNode;
  const { component: _component, className: _className, sx: _sx, children: _children, ...props } = input;
  void _component;
  void _className;
  void _sx;
  void _children;
  return createElement(component, { ref, className: joinClasses("kumo-box", sxClassName(sx), className), ...props }, children);
});

export const Paper = forwardRef<HTMLElement, LayoutProps>(function Paper(input, ref) {
  const component = (input.component ?? "div") as ElementType;
  const className = input.className as string | undefined;
  const sx = input.sx as SxProps | undefined;
  const children = input.children as ReactNode;
  const { component: _component, className: _className, sx: _sx, children: _children, ...props } = input;
  void _component;
  void _className;
  void _sx;
  void _children;
  return createElement(component, { ref, className: joinClasses("kumo-paper", sxClassName(sx), className), ...props }, children);
});

type TypographyProps = LayoutProps & { variant?: string };

export const Typography = forwardRef<HTMLElement, TypographyProps>(function Typography(input, ref) {
  const component = (input.component ?? "span") as ElementType;
  const variant = input.variant as string | undefined;
  const className = input.className as string | undefined;
  const sx = input.sx as SxProps | undefined;
  const children = input.children as ReactNode;
  const { component: _component, variant: _variant, className: _className, sx: _sx, children: _children, ...props } = input;
  void _component;
  void _variant;
  void _className;
  void _sx;
  void _children;
  return createElement(component, { ref, className: joinClasses("kumo-typography", variant ? `kumo-typography--${variant}` : undefined, sxClassName(sx), className), ...props }, children);
});

type StackProps = LayoutProps & { direction?: string | Record<string, string>; spacing?: number | string; useFlexGap?: boolean };

export const Stack = forwardRef<HTMLDivElement, StackProps>(function Stack({ direction = "column", spacing, className, sx, children, useFlexGap: _useFlexGap, ...props }, ref) {
  void _useFlexGap;
  const stackSx: SxProps = {
    display: "flex",
    flexDirection: direction,
    ...(spacing !== undefined ? { gap: spacing } : {}),
    ...(sx ?? {}),
  };
  return createElement("div", { ref, className: joinClasses("kumo-stack", sxClassName(stackSx), className), ...props }, children);
});

type ButtonProps = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "color"> & {
  component?: "button" | "a";
  color?: string;
  variant?: string;
  size?: "small" | "medium" | "large";
  fullWidth?: boolean;
  startIcon?: ReactNode;
  endIcon?: ReactNode;
  sx?: SxProps;
  href?: string;
};

const buttonVariant = (variant?: string): "primary" | "secondary" | "ghost" | "outline" | "destructive" => {
  if (variant === "contained" || variant === "primary") return "primary";
  if (variant === "text" || variant === "ghost") return "ghost";
  if (variant === "destructive") return "destructive";
  if (variant === "outline") return "outline";
  return "secondary";
};

const buttonSize = (size?: ButtonProps["size"]): "sm" | "base" | "lg" => {
  if (size === "small") return "sm";
  if (size === "large") return "lg";
  return "base";
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({
  component = "button",
  className,
  sx,
  variant,
  size,
  fullWidth,
  color: _color,
  startIcon,
  endIcon,
  children,
  ...props
}, ref) {
  void _color;
  const classes = joinClasses("kumo-button", fullWidth && "kumo-button--full", sxClassName(sx), className);
  const content = <>{startIcon && <span className="kumo-button__start-icon">{startIcon}</span>}{children}{endIcon && <span className="kumo-button__end-icon">{endIcon}</span>}</>;
  if (component === "a") {
    const { href, ...linkProps } = props as React.AnchorHTMLAttributes<HTMLAnchorElement> & { href?: string };
    return <KumoLinkButton ref={ref as never} href={href} className={classes} variant={buttonVariant(variant)} size={buttonSize(size)} {...linkProps}>{content}</KumoLinkButton>;
  }
  return <KumoButton ref={ref} className={classes} variant={buttonVariant(variant)} size={buttonSize(size)} {...props}>{content}</KumoButton>;
});

type ButtonGroupProps = LayoutProps & { variant?: string; size?: string };

export const ButtonGroup = forwardRef<HTMLDivElement, ButtonGroupProps>(function ButtonGroup({ className, sx, children, ...props }, ref) {
  return <div ref={ref} className={joinClasses("kumo-button-group", sxClassName(sx), className)} {...props}>{children}</div>;
});

type FormControlProps = LayoutProps & { fullWidth?: boolean };

export const FormControl = forwardRef<HTMLDivElement, FormControlProps & { size?: string }>(function FormControl({ className, sx, fullWidth, children, size: _size, ...props }, ref) {
  void _size;
  return <div ref={ref} className={joinClasses("kumo-form-control", fullWidth && "kumo-form-control--full", sxClassName(sx), className)} {...props}>{children}</div>;
});

type InputLabelProps = React.LabelHTMLAttributes<HTMLLabelElement> & { sx?: SxProps };

export const InputLabel = forwardRef<HTMLLabelElement, InputLabelProps>(function InputLabel({ className, sx, children, ...props }, ref) {
  return <label ref={ref} className={joinClasses("kumo-input-label", sxClassName(sx), className)} {...props}>{children}</label>;
});

type SelectChangeEvent = { target: { value: unknown } };

function nodeText(value: ReactNode): string {
  return Children.toArray(value).map((part) => {
    if (typeof part === "string" || typeof part === "number") return String(part);
    if (isValidElement(part)) return nodeText((part.props as { children?: ReactNode }).children);
    return "";
  }).join("");
}

type SelectProps = {
  id?: string;
  value?: string | number;
  label?: ReactNode;
  labelId?: string;
  "aria-label"?: string;
  className?: string;
  sx?: SxProps;
  fullWidth?: boolean;
  renderValue?: (value: string | number) => ReactNode;
  onChange?: (event: SelectChangeEvent) => void;
  children?: ReactNode;
};

export function Select({ id, value, label, labelId: _labelId, onChange, renderValue, className, sx, fullWidth, children, ...props }: SelectProps) {
  void _labelId;
  const selected = value === undefined ? null : String(value);
  const { labels, textValues } = useMemo(() => {
    const nextLabels = new Map<string, ReactNode>();
    const nextTextValues = new Map<string, string>();
    for (const child of Children.toArray(children)) {
      if (isValidElement(child)) {
        const childProps = child.props as { value?: string | number; children?: ReactNode };
        if (childProps.value !== undefined) {
          nextLabels.set(String(childProps.value), childProps.children);
          nextTextValues.set(nodeText(childProps.children), String(childProps.value));
        }
      }
    }
    return { labels: nextLabels, textValues: nextTextValues };
  }, [children]);
  useEffect(() => {
    if (!onChange) return undefined;
    const handleOptionClick = (event: MouseEvent) => {
      const target = event.target as Element | null;
      const option = target?.closest('[role="option"]');
      if (!option) return;
      const optionValue = textValues.get(option.textContent?.trim() ?? "");
      if (optionValue !== undefined) onChange({ target: { value: optionValue } });
    };
    document.addEventListener("click", handleOptionClick, true);
    return () => document.removeEventListener("click", handleOptionClick, true);
  }, [onChange, textValues]);
  const selectedValue = renderValue ?? ((next: string | number) => labels.get(String(next)) ?? next);
  return (
    <KumoSelect
      {...props}
      id={id}
      aria-label={props["aria-label"] ?? (typeof label === "string" ? label : undefined)}
      value={selected}
      renderValue={(next) => selectedValue(next)}
      render={(triggerProps) => {
        const { className: triggerClassName, onMouseDown, ...restTriggerProps } = triggerProps;
        return (
          <button
            {...restTriggerProps}
            className={joinClasses(triggerClassName, "kumo-select-trigger")}
            onMouseDown={(event) => {
              // Kumo opens selects on mousedown. When a custom trigger is
              // rendered, let the programmatic click own the closed->open
              // transition so the native mousedown handler cannot schedule a
              // second transition that immediately closes the popup.
              if (event.currentTarget.getAttribute("aria-expanded") !== "true") {
                event.preventDefault();
                event.currentTarget.click();
                return;
              }
              onMouseDown?.(event);
            }}
          />
        );
      }}
      onValueChange={(next) => onChange?.({ target: { value: next ?? "" } })}
      className={joinClasses("kumo-select", fullWidth && "kumo-select--full", sxClassName(sx), className)}
    >
      {children}
    </KumoSelect>
  );
}

export function MenuItem({ value, children, disabled }: { value: string | number; children?: ReactNode; disabled?: boolean }) {
  return (
    <KumoSelect.Option
      value={String(value)}
      disabled={disabled}
    >
      {children}
    </KumoSelect.Option>
  );
}

type TextFieldProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "size"> & {
  label?: ReactNode;
  fullWidth?: boolean;
  size?: "small" | "medium";
  sx?: SxProps;
  slotProps?: { htmlInput?: React.InputHTMLAttributes<HTMLInputElement> };
};

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField({ label, fullWidth, className, sx, slotProps, size, ...props }, ref) {
  return <KumoInput ref={ref} {...slotProps?.htmlInput} {...props} size={size === "small" ? "sm" : "base"} label={label} className={joinClasses("kumo-text-field", fullWidth && "kumo-text-field--full", sxClassName(sx), className)} />;
});

type SliderProps = {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange?: (_event: React.ChangeEvent<HTMLInputElement>, value: number) => void;
  "aria-label"?: string;
  className?: string;
  sx?: SxProps;
  valueLabelDisplay?: string;
  valueLabelFormat?: (value: number) => ReactNode;
};

export function Slider({ value, min, max, step, onChange, className, sx, valueLabelDisplay: _valueLabelDisplay, valueLabelFormat: _valueLabelFormat, ...props }: SliderProps) {
  void _valueLabelDisplay;
  void _valueLabelFormat;
  return <input type="range" value={value} min={min} max={max} step={step} aria-valuenow={value} aria-valuemin={min} aria-valuemax={max} onChange={(event) => onChange?.(event, Number(event.target.value))} className={joinClasses("kumo-slider", sxClassName(sx), className)} {...props} />;
}

type ChipProps = {
  label: ReactNode;
  className?: string;
  variant?: string;
  color?: string;
  size?: string;
  sx?: SxProps;
};

export function Chip({ label, className, variant, color, sx }: ChipProps) {
  const badgeVariant = color === "warning" ? "warning" : color === "error" ? "error" : variant === "outlined" ? "outline" : "neutral";
  return <KumoBadge variant={badgeVariant} className={joinClasses("kumo-chip", sxClassName(sx), className)}>{label}</KumoBadge>;
}

type AlertProps = { severity?: "error" | "warning" | "info" | "success"; className?: string; sx?: SxProps; children?: ReactNode };

export function Alert({ severity = "info", className, sx, children }: AlertProps) {
  return <KumoBanner role="alert" variant={severity === "error" ? "error" : severity === "warning" ? "alert" : "default"} className={joinClasses("kumo-alert", sxClassName(sx), className)} description={children} />;
}

type DialogProps = {
  open?: boolean;
  onClose?: () => void;
  className?: string;
  sx?: SxProps;
  children?: ReactNode;
  [key: string]: unknown;
};

export function Dialog({ open = false, onClose, className, sx, children, ...props }: DialogProps) {
  return (
    <KumoDialog.Root open={open} onOpenChange={(next) => { if (!next) onClose?.(); }} {...props}>
      <KumoDialog className={joinClasses("kumo-dialog", sxClassName(sx), className)}>{children}</KumoDialog>
    </KumoDialog.Root>
  );
}

export function DialogTitle({ id, children, className }: { id?: string; children?: ReactNode; className?: string }) {
  return <KumoDialog.Title id={id} className={joinClasses("kumo-dialog-title", className)}>{children}</KumoDialog.Title>;
}

export function DialogContent({ children, className }: { children?: ReactNode; className?: string }) {
  return <div className={joinClasses("kumo-dialog-content", className)}>{children}</div>;
}

export function DialogContentText({ id, children, className }: { id?: string; children?: ReactNode; className?: string }) {
  return <KumoDialog.Description id={id} className={joinClasses("kumo-dialog-description", className)}>{children}</KumoDialog.Description>;
}

export function DialogActions({ children, className }: { children?: ReactNode; className?: string }) {
  return <div className={joinClasses("kumo-dialog-actions", className)}>{children}</div>;
}

export function SvgIcon({ children, viewBox = "0 0 24 24", fontSize: _fontSize, className, ...props }: React.SVGProps<SVGSVGElement> & { fontSize?: string }) {
  void _fontSize;
  return <svg viewBox={viewBox} className={joinClasses("kumo-svg-icon", className)} fill="currentColor" focusable="false" aria-hidden="true" {...props}>{children}</svg>;
}
