/** @type {AppTypes.Config} */
window.config = {
  routerBasename: null,
  showStudyList: true,
  // Logo 点击返回 NEXUS 主页（本地开发主页 = http://localhost:8791/）。
  // 该配置同时服务于 rsbuild 开发服务器(研究空间 :3000)与 docker 后台(:1026)，
  // 渲染位置见 platform/ui/src/components/Header/Header.tsx 的 createLogoComponentFn。
  whiteLabeling: {
    createLogoComponentFn: function (React) {
      return React.createElement(
        'a',
        {
          href: 'http://localhost:8791/',
          target: '_self',
          title: '返回主页',
          style: {
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            textDecoration: 'none',
            color: '#ffffff',
          },
        },
        React.createElement(
          'span',
          { style: { fontWeight: 600, fontSize: '15px', letterSpacing: '.16em' } },
          'NEXUS'
        ),
        React.createElement(
          'span',
          {
            style: {
              fontSize: '11px',
              opacity: 0.65,
              border: '1px solid rgba(255,255,255,.35)',
              borderRadius: '4px',
              padding: '2px 6px',
            },
          },
          '← 主页'
        )
      );
    },
  },
  extensions: [],
  modes: [],
  // below flag is for performance reasons, but it might not work for all servers
  showWarningMessageForCrossOrigin: true,
  showCPUFallbackMessage: true,
  showLoadingIndicator: true,
  disableConfirmationPrompts: true,
  // Allow drawing in any viewport on the first pointer event without needing
  // a prior click to "activate" it. Essential for MPR multi-viewport workflows.
  activateViewportBeforeInteraction: false,
  showPatientInfo: 'disabled',
  measurementTrackingMode: 'none',
  experimentalStudyBrowserSort: false,
  strictZSpacingForVolumeViewport: true,
  studyPrefetcher: {
    enabled: true,
    displaySetsCount: 2,
    maxNumPrefetchRequests: 10,
    order: 'closest',
  },
  defaultDataSourceName: 'dicomweb',
  investigationalUseDialog: {
    option: 'never',
  },
  dataSources: [
    {
      namespace: '@ohif/extension-default.dataSourcesModule.dicomweb',
      sourceName: 'dicomweb',
      configuration: {
        friendlyName: 'Orthanc Server',
        name: 'Orthanc',
        wadoUriRoot: '/wado',
        qidoRoot: '/pacs/dicom-web',
        wadoRoot: '/pacs/dicom-web',
        qidoSupportsIncludeField: false,
        imageRendering: 'wadors',
        thumbnailRendering: 'wadors',
        enableStudyLazyLoad: true,
        dicomUploadEnabled: true,
        supportsFuzzyMatching: true,
        supportsWildcard: true,
        omitQuotationForMultipartRequest: true,
      },
    },
    {
      namespace: '@ohif/extension-default.dataSourcesModule.dicomjson',
      sourceName: 'dicomjson',
      configuration: {
        friendlyName: 'dicom json',
        name: 'json',
      },
    },
    {
      namespace: '@ohif/extension-default.dataSourcesModule.dicomlocal',
      sourceName: 'dicomlocal',
      configuration: {
        friendlyName: 'dicom local',
      },
    },
  ],
  httpErrorHandler: error => {
    console.warn(`HTTP Error Handler (status: ${error.status})`, error);
  },
};
