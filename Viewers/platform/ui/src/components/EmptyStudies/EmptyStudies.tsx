import React from 'react';
import PropTypes from 'prop-types';
import classnames from 'classnames';
import { useTranslation } from 'react-i18next';

import Typography from '../Typography';
import { Icons } from '@ohif/ui-next';

const EmptyStudies = ({ className = '' }) => {
  const { t } = useTranslation('StudyList');
  return (
    <div className={classnames('inline-flex flex-col items-center px-6 text-center', className)}>
      <div className="bg-accent mb-5 flex h-20 w-20 items-center justify-center rounded-full">
        <Icons.Magnifier className="text-primary h-10 w-10" />
      </div>
      <Typography
        className="text-foreground mb-2 text-lg font-semibold"
        variant="h5"
      >
        {t('No studies available')}
      </Typography>
      <p className="text-muted-foreground max-w-sm text-sm leading-relaxed">
        上传 DICOM 研究或调整筛选条件，开始 AI 分割与报告生成工作流。
      </p>
    </div>
  );
};

EmptyStudies.propTypes = {
  className: PropTypes.string,
};

export default EmptyStudies;
