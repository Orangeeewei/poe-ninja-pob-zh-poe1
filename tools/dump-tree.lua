-- dump-tree.lua — 讀 PoB 的 TreeData/x_y/tree.lua,輸出精簡 JSON(node id → 名稱/類型/詞綴)。
-- 用法:luajit dump-tree.lua <tree.lua 路徑>
-- 只輸出分析需要的:keystone(k)/notable(n)/mastery(m)/jewel socket(j);normal 小點僅名稱。
local path = arg and arg[1]
if not path then io.stderr:write('用法:luajit dump-tree.lua <tree.lua>\n'); os.exit(1) end

local ok, tree = pcall(dofile, path)
if not ok or type(tree) ~= 'table' or type(tree.nodes) ~= 'table' then
  io.stderr:write('讀取失敗:' .. tostring(tree) .. '\n'); os.exit(1)
end

local function esc(s)
  s = tostring(s)
  s = s:gsub('\\', '\\\\'):gsub('"', '\\"'):gsub('\n', '\\n'):gsub('\r', ''):gsub('\t', '\\t')
  return s
end
local function strarr(t)
  local out = {}
  for _, v in ipairs(t or {}) do out[#out + 1] = '"' .. esc(v) .. '"' end
  return '[' .. table.concat(out, ',') .. ']'
end

local parts = {}
for id, nd in pairs(tree.nodes) do
  if type(nd) == 'table' and nd.name and id ~= 'root' then
    local ty = nd.isKeystone and 'k' or nd.isNotable and 'n' or nd.isMastery and 'm'
      or nd.isJewelSocket and 'j' or nil
    local fields = { '"n":"' .. esc(nd.name) .. '"' }
    if ty then fields[#fields + 1] = '"t":"' .. ty .. '"' end
    if nd.ascendancyName then fields[#fields + 1] = '"a":"' .. esc(nd.ascendancyName) .. '"' end
    -- 詞綴:只收 keystone/notable(小點太多會爆檔案)
    if (ty == 'k' or ty == 'n') and nd.stats then fields[#fields + 1] = '"s":' .. strarr(nd.stats) end
    -- mastery 效果池:effect id → 詞綴(build XML 的 masteryEffects 用 effect id 對回文字)
    if ty == 'm' and nd.masteryEffects then
      local eff = {}
      for _, e in ipairs(nd.masteryEffects) do
        if e.effect then eff[#eff + 1] = '"' .. tostring(e.effect) .. '":' .. strarr(e.stats) end
      end
      fields[#fields + 1] = '"e":{' .. table.concat(eff, ',') .. '}'
    end
    parts[#parts + 1] = '"' .. tostring(nd.skill or id) .. '":{' .. table.concat(fields, ',') .. '}'
  end
end

io.write('{"nodes":{' .. table.concat(parts, ',') .. '}}')
