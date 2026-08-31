import React from 'react';
import PropTypes from 'prop-types';
import { useTranslation } from 'react-i18next';

import LegacyButton from '../LegacyButton';
import Typography from '../Typography';
import InputGroup from '../InputGroup';
import { Icons } from '@ohif/ui-next';

const StudyListFilter = ({
  filtersMeta,
  filterValues,
  onChange,
  clearFilters,
  isFiltering,
  numOfStudies,
  onUploadClick,
  getDataSourceConfigurationComponent,
}) => {
  const { t } = useTranslation('StudyList');
  const { sortBy, sortDirection } = filterValues;
  const filterSorting = { sortBy, sortDirection };
  const setFilterSorting = sortingValues => {
    onChange({
      ...filterValues,
      ...sortingValues,
    });
  };
  const isSortingEnabled = numOfStudies > 0 && numOfStudies <= 100;

  return (
    <React.Fragment>
      <div className="border-border border-b bg-card">
        <div className="container relative mx-auto flex flex-col px-6 pt-6 pb-4">
          <div className="flex flex-row items-end justify-between gap-4">
            <div className="flex min-w-[1px] shrink flex-row flex-wrap items-center gap-5">
              <div>
                <p className="text-primary mb-1 text-xs font-medium tracking-wide uppercase">
                  AI 影像平台
                </p>
                <Typography
                  variant="h6"
                  className="text-foreground text-2xl font-semibold"
                >
                  {t('StudyList')}
                </Typography>
              </div>
              {getDataSourceConfigurationComponent && getDataSourceConfigurationComponent()}
              {onUploadClick && (
                <button
                  type="button"
                  className="text-primary hover:bg-accent inline-flex cursor-pointer items-center gap-2 self-center rounded-md px-3 py-2 text-sm font-medium transition-colors"
                  onClick={onUploadClick}
                >
                  <Icons.Upload />
                  <span>{t('Upload')}</span>
                </button>
              )}
            </div>
            <div className="flex h-[34px] flex-row items-center gap-3">
              {isFiltering && (
                <LegacyButton
                  rounded="full"
                  variant="outlined"
                  color="primaryActive"
                  border="primaryActive"
                  startIcon={<Icons.Cancel />}
                  onClick={clearFilters}
                >
                  {t('ClearFilters')}
                </LegacyButton>
              )}
              <div className="clinical-surface flex items-baseline gap-2 px-4 py-2">
                <Typography
                  variant="h6"
                  className="text-primary text-2xl font-semibold tabular-nums"
                  data-cy={'num-studies'}
                >
                  {numOfStudies > 100 ? '>100' : numOfStudies}
                </Typography>
                <Typography
                  variant="h6"
                  className="text-muted-foreground text-sm font-normal"
                >
                  {t('Studies')}
                </Typography>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="clinical-filter-bar sticky -top-1 z-10">
        <div className="py-4">
          <InputGroup
            inputMeta={filtersMeta}
            values={filterValues}
            onValuesChange={onChange}
            sorting={filterSorting}
            onSortingChange={setFilterSorting}
            isSortingEnabled={isSortingEnabled}
          />
        </div>
        {numOfStudies > 100 && (
          <div className="container m-auto px-6 pb-3">
            <div className="bg-primary/10 text-primary rounded-md py-2 text-center text-sm">
              <p>{t('Filter list to 100 studies or less to enable sorting')}</p>
            </div>
          </div>
        )}
      </div>
    </React.Fragment>
  );
};

StudyListFilter.propTypes = {
  filtersMeta: PropTypes.arrayOf(
    PropTypes.shape({
      name: PropTypes.string.isRequired,
      displayName: PropTypes.string.isRequired,
      inputType: PropTypes.oneOf(['Text', 'MultiSelect', 'DateRange', 'None']).isRequired,
      isSortable: PropTypes.bool.isRequired,
      gridCol: PropTypes.oneOf([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]).isRequired,
      option: PropTypes.arrayOf(
        PropTypes.shape({
          value: PropTypes.string,
          label: PropTypes.string,
        })
      ),
    })
  ).isRequired,
  filterValues: PropTypes.object.isRequired,
  numOfStudies: PropTypes.number.isRequired,
  onChange: PropTypes.func.isRequired,
  clearFilters: PropTypes.func.isRequired,
  isFiltering: PropTypes.bool.isRequired,
  onUploadClick: PropTypes.func,
  getDataSourceConfigurationComponent: PropTypes.func,
};

export default StudyListFilter;
