const getToggledClassName = isToggled => {
  return isToggled
    ? '!text-primary'
    : '!text-foreground/70 hover:!bg-accent hover:!text-primary';
};

export { getToggledClassName };
