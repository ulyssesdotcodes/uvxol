module.exports = {
  devServer: {
    stats: 'errors-only',
    overlay: {
      warnings: false,
      errors: true
    },
    hot: false,
    liveReload: false,
    https: true
  },
  lintOnSave: false
}