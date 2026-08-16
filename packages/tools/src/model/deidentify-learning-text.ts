const replacements: readonly [RegExp, string][] = [
  [/https?:\/\/\S+/giu, "[链接已隐藏]"],
  [/[\w.+-]+@[\w.-]+\.[a-z]{2,}/giu, "[邮箱已隐藏]"],
  [/(?<!\d)1[3-9]\d{9}(?!\d)/gu, "[手机号已隐藏]"],
  [/(?<!\d)\d{15,18}[0-9Xx]?(?!\d)/gu, "[证件号已隐藏]"],
  [/(?:姓名|名字|name)\s*[:：]\s*[\p{L}·.]{2,30}/giu, "[姓名已隐藏]"],
  [/我叫\s*[\p{Script=Han}·]{2,8}/gu, "我叫[姓名已隐藏]"],
  [/(?:就读学校|学校|school)\s*[:：]\s*[^，。；;\n]{2,60}/giu, "[学校已隐藏]"],
  [/我在\s*[^，。；;\n]{2,40}(?:学校|中学|小学|学院)(?:上学|读书|学习)?/gu, "我在[学校已隐藏]学习"],
  [/(?:班级|class)\s*[:：]\s*[^，。；;\n]{1,30}/giu, "[班级已隐藏]"],
  [/[一二三四五六七八九123456789]\s*年级\s*[一二三四五六七八九十\d]{1,3}\s*班/gu, "[班级已隐藏]"],
  [/(?:家庭住址|住址|地址|address)\s*[:：]\s*[^，。；;\n]{4,100}/giu, "[住址已隐藏]"],
  [/我住在\s*[^，。；;\n]{4,100}/gu, "我住在[住址已隐藏]"],
];

export function deidentifyLearningText(value: string, maxLength = 800) {
  let redacted = false;
  let text = value.normalize("NFKC");
  for (const [pattern, replacement] of replacements) {
    text = text.replace(pattern, () => {
      redacted = true;
      return replacement;
    });
  }
  text = text.replace(/[\u0000-\u001f\u007f]/gu, " ").replace(/\s+/gu, " ").trim();
  return { text: text.slice(0, maxLength), redacted } as const;
}
