import React from 'react';
import { Tooltip, TooltipTrigger, TooltipContent } from '../Tooltip';
import { Icons } from '../Icons';
import { Button } from '../Button';
import { cn } from '../../lib/utils';

const baseClasses = '!rounded-lg inline-flex items-center justify-center transition-colors';
const defaultClasses = 'bg-transparent text-foreground/70 hover:bg-accent hover:text-primary';
const activeClasses = 'bg-primary text-primary-foreground hover:!bg-primary/90';
const disabledClasses =
  'text-foreground/40 disabled:!opacity-100 cursor-not-allowed';
const focusClasses = 'focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-offset-2';

const sizeClasses = {
  default: {
    buttonSizeClass: 'w-10 h-10',
    iconSizeClass: 'h-7 w-7',
  },
  small: {
    buttonSizeClass: 'w-8 h-8',
    iconSizeClass: 'h-6 w-6',
  },
};

interface ToolButtonProps {
  id: string;
  icon?: string;
  label?: string;
  tooltip?: string;
  size?: 'default' | 'small';
  isActive?: boolean;
  disabled?: boolean;
  disabledText?: string;
  commands?: Record<string, unknown>;
  onInteraction?: (details: { itemId: string; commands?: Record<string, unknown> }) => void;
  className?: string;
}

function ToolButton(props: ToolButtonProps) {
  const {
    id,
    icon = 'MissingIcon',
    label,
    tooltip,
    size = 'default',
    disabled = false,
    isActive = false,
    disabledText,
    commands,
    onInteraction,
    className,
  } = props;

  const { buttonSizeClass, iconSizeClass } = sizeClasses[size] || sizeClasses.default;

  const buttonClasses = cn(
    baseClasses,
    buttonSizeClass,
    focusClasses,
    disabled ? disabledClasses : isActive ? activeClasses : defaultClasses,
    className
  );

  const defaultTooltip = label;
  const disabledTooltip = disabled && disabledText ? disabledText : null;
  const hasSecondaryTooltip = tooltip || disabledTooltip;

  const showTooltip = hasSecondaryTooltip || defaultTooltip;

  return (
    <Tooltip>
      <TooltipTrigger
        asChild
        className={cn(disabled && 'cursor-not-allowed')}
      >
        {/* TooltipTrigger is a span since a disabled button does not fire events and the tooltip
        will not show. */}
        <span
          data-cy={id}
          data-tool={id}
          data-active={isActive}
        >
          <Button
            className={buttonClasses}
            onClick={() => {
              if (!disabled) {
                onInteraction?.({ itemId: id, commands });
              }
            }}
            variant="ghost"
            size="icon"
            aria-label={defaultTooltip}
            disabled={disabled}
          >
            <Icons.ByName
              name={icon}
              className={iconSizeClass}
            />
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent
        side="bottom"
        className="text-wrap w-auto max-w-sm whitespace-normal break-words"
      >
        {showTooltip && (
          <div className="space-y-1">
            {defaultTooltip && <div className="text-sm">{defaultTooltip}</div>}
            {disabledTooltip ? (
              <div className="text-muted-foreground text-xs">{disabledTooltip}</div>
            ) : (
              tooltip && <div className="text-muted-foreground text-xs">{tooltip}</div>
            )}
          </div>
        )}
      </TooltipContent>
    </Tooltip>
  );
}

export default ToolButton;
