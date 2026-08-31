import React from 'react';
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from '../Accordion/Accordion';
import { cn } from '../../lib/utils';
import { Icons } from '../Icons/Icons';

interface PanelSectionProps {
  children: React.ReactNode;
  defaultOpen?: boolean;
  className?: string;
}

interface PanelSectionHeaderProps {
  children: React.ReactNode;
  className?: string;
  showChevron?: boolean;
}

interface PanelSectionContentProps {
  children: React.ReactNode;
  className?: string;
}

export const PanelSection: React.FC<PanelSectionProps> & {
  Header: React.FC<PanelSectionHeaderProps>;
  Content: React.FC<PanelSectionContentProps>;
} = ({ children, defaultOpen = true, className }) => {
  return (
    <Accordion
      type="single"
      collapsible
      defaultValue={defaultOpen ? 'item' : undefined}
      className={cn('flex-shrink-0 overflow-hidden', className)}
    >
      <AccordionItem
        value="item"
        className="border-none"
      >
        {children}
      </AccordionItem>
    </Accordion>
  );
};

PanelSection.Header = ({ children, className }) => (
  <AccordionTrigger
    className={cn(
      'text-foreground border-l-4 border-l-transparent border-b border-b-transparent',
      'my-0 flex h-10 w-full items-center justify-between rounded-none py-2 pr-3 pl-3 text-[13px] font-semibold tracking-[0.01em]',
      'bg-muted/30 hover:bg-accent/60',
      // 展开时用更明确的浅色底、蓝色左侧标记与底部分隔线强调当前模块。
      '[&[data-state=open]]:border-l-primary [&[data-state=open]]:bg-accent/50 [&[data-state=open]]:border-b-border/70',
      className
    )}
  >
    {children}
  </AccordionTrigger>
);

PanelSection.Header.displayName = 'PanelSection.Header';

PanelSection.Content = ({ children, className }) => (
  <AccordionContent className={cn('overflow-hidden p-0', className)}>
    <div className="rounded-b">{children}</div>
  </AccordionContent>
);

PanelSection.Content.displayName = 'PanelSection.Content';
