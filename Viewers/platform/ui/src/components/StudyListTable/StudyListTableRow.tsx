import React from 'react';
import PropTypes from 'prop-types';
import classnames from 'classnames';
import getGridWidthClass from '../../utils/getGridWidthClass';
import { Icons } from '@ohif/ui-next';

const StudyListTableRow = props => {
  const { tableData } = props;
  const { row, expandedContent, onClickRow, isExpanded, dataCY, clickableCY } = tableData;
  return (
    <>
      <tr
        className="select-none"
        data-cy={dataCY}
      >
        <td className="border-0 p-0">
          <div
            className={classnames(
              'clinical-surface w-full overflow-hidden transition-all duration-200',
              {
                'ring-primary/30 shadow-md ring-2': isExpanded,
                'hover:border-primary/30 hover:shadow-md': !isExpanded,
              }
            )}
          >
            <table className="w-full">
              <tbody>
                <tr
                  className={classnames(
                    'cursor-pointer transition-colors duration-200',
                    {
                      'bg-accent/40': isExpanded,
                      'hover:bg-accent/30': !isExpanded,
                    }
                  )}
                  onClick={onClickRow}
                  data-cy={clickableCY}
                >
                  {row.map((cell, index) => {
                    const { content, title, gridCol } = cell;
                    return (
                      <td
                        key={index}
                        className={classnames(
                          'truncate px-4 py-3 text-sm',
                          getGridWidthClass(gridCol) || ''
                        )}
                        style={{
                          maxWidth: 0,
                        }}
                        title={title}
                      >
                        <div className="flex items-center">
                          {index === 0 && (
                            <div className="text-primary mr-3 shrink-0">
                              {isExpanded ? (
                                <Icons.ChevronOpen className="inline-flex" />
                              ) : (
                                <Icons.ChevronClosed className="inline-flex rotate-180" />
                              )}
                            </div>
                          )}
                          <div className={classnames('overflow-hidden truncate')}>{content}</div>
                        </div>
                      </td>
                    );
                  })}
                </tr>
                {isExpanded && (
                  <tr className="max-h-0 w-full select-text overflow-hidden border-t border-border bg-card">
                    <td
                      className="p-4"
                      colSpan={row.length}
                    >
                      {expandedContent}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </td>
      </tr>
    </>
  );
};

StudyListTableRow.propTypes = {
  tableData: PropTypes.shape({
    row: PropTypes.arrayOf(
      PropTypes.shape({
        key: PropTypes.string.isRequired,
        content: PropTypes.node,
        title: PropTypes.string,
        gridCol: PropTypes.number.isRequired,
      })
    ).isRequired,
    expandedContent: PropTypes.node.isRequired,
    onClickRow: PropTypes.func.isRequired,
    isExpanded: PropTypes.bool.isRequired,
    dataCY: PropTypes.string,
    clickableCY: PropTypes.string,
  }),
};

export default StudyListTableRow;
