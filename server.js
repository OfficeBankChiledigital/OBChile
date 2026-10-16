// ... (keep existing file header and previous code unchanged up to app.get("/config"))

// Health endpoint for diagnostics
app.get('/health', (req, res) => {
  const cwd = process.cwd();
  const dirname = __dirname;
  const files = {
    data_cfg_exists: fs.existsSync(dataCfgPath),
    root_cfg_exists: fs.existsSync(rootCfgPath),
    tmp_cfg_exists: fs.existsSync(tmpCfgPath)
  };

  // test write permission in data dir
  let canWriteData = false;
  try {
    const testPath = path.join(path.dirname(dataCfgPath), `.writetest_${Date.now()}`);
    fs.writeFileSync(testPath, 'ok');
    fs.unlinkSync(testPath);
    canWriteData = true;
  } catch (e) {
    canWriteData = false;
  }

  res.json({ ok: true, cwd, dirname, files, canWriteData, node_version: process.version });
});

// ... (rest of file unchanged)
