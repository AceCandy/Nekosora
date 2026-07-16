# -*- coding: utf-8 -*-
"""strip_conversation_images 的单元测试（标准库 unittest，无需 pytest）。

运行：
    cd .claude/skills/strip-conversation-images
    python test_strip.py
"""
import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import strip_conversation_images as M  # noqa: E402

# 两种真实出现过的 image block 格式
IMG_ANTHROPIC = {
    "type": "image",
    "source": {"type": "base64", "media_type": "image/png", "data": "iVBORw0KGgo"},
}
IMG_TOOLUSE = {
    "type": "image",
    "file": {"base64": "iVBORw0KGgo", "type": "png", "originalSize": 10, "dimensions": {}},
}


class TestIsImageBlock(unittest.TestCase):
    def test_anthropic_format(self):
        self.assertTrue(M.is_image_block(IMG_ANTHROPIC))

    def test_tooluse_format(self):
        self.assertTrue(M.is_image_block(IMG_TOOLUSE))

    def test_text_block_not_image(self):
        self.assertFalse(M.is_image_block({"type": "text", "text": "hi"}))

    def test_tool_result_not_image(self):
        self.assertFalse(M.is_image_block({"type": "tool_result", "content": [IMG_ANTHROPIC]}))

    def test_non_dict(self):
        self.assertFalse(M.is_image_block("hello"))
        self.assertFalse(M.is_image_block(42))
        self.assertFalse(M.is_image_block(None))


class TestStripImages(unittest.TestCase):
    def test_replaces_anthropic_image_with_text_block(self):
        new, n = M.strip_images(IMG_ANTHROPIC)
        self.assertEqual(n, 1)
        self.assertEqual(new["type"], "text")
        self.assertIn("已移除", new["text"])

    def test_replaces_tooluse_image_with_string(self):
        new, n = M.strip_images(IMG_TOOLUSE)
        self.assertEqual(n, 1)
        self.assertIsInstance(new, str)
        self.assertIn("已移除", new)

    def test_nested_in_tool_result_content(self):
        msg = {"role": "user", "content": [
            {"type": "tool_result", "tool_use_id": "x", "content": [IMG_ANTHROPIC]}
        ]}
        new, n = M.strip_images(msg)
        self.assertEqual(n, 1)
        self.assertEqual(new["content"][0]["content"][0]["type"], "text")

    def test_preserves_other_content(self):
        msg = {"role": "assistant", "content": [
            {"type": "text", "text": "hi"}, {"type": "text", "text": "bye"}
        ]}
        new, n = M.strip_images(msg)
        self.assertEqual(n, 0)
        self.assertEqual(new["content"][1]["text"], "bye")

    def test_multiple_images_mixed(self):
        msg = {"content": [IMG_ANTHROPIC, IMG_TOOLUSE, {"type": "text", "text": "x"}]}
        new, n = M.strip_images(msg)
        self.assertEqual(n, 2)
        self.assertEqual(new["content"][0]["type"], "text")
        self.assertIsInstance(new["content"][1], str)
        self.assertEqual(new["content"][2]["text"], "x")

    def test_toolUseResult_field_replaced(self):
        obj = {
            "message": {"role": "user", "content": [
                {"type": "tool_result", "content": [IMG_ANTHROPIC]}
            ]},
            "toolUseResult": IMG_TOOLUSE,
        }
        new, n = M.strip_images(obj)
        self.assertEqual(n, 2)
        self.assertIsInstance(new["toolUseResult"], str)
        self.assertEqual(new["message"]["content"][0]["content"][0]["type"], "text")

    def test_no_image_unchanged_structure(self):
        msg = {"a": {"b": [1, 2, "x"]}, "c": "y"}
        new, n = M.strip_images(msg)
        self.assertEqual(n, 0)
        self.assertEqual(new, msg)


class TestCountImages(unittest.TestCase):
    def test_count_three(self):
        obj = {"a": IMG_ANTHROPIC, "b": [IMG_TOOLUSE, {"x": IMG_ANTHROPIC}]}
        self.assertEqual(M.count_images(obj), 3)

    def test_count_zero(self):
        self.assertEqual(M.count_images({"a": "b"}), 0)
        self.assertEqual(M.count_images([1, 2, 3]), 0)

    def test_count_standalone(self):
        self.assertEqual(M.count_images(IMG_ANTHROPIC), 1)


class TestProcessFile(unittest.TestCase):
    @staticmethod
    def _make_session_lines():
        return [
            json.dumps({"type": "summary", "summary": "x"}),
            json.dumps({"type": "user", "message": {"role": "user", "content": [{"type": "text", "text": "hi"}]}}),
            json.dumps({"type": "user", "message": {"role": "user", "content": [
                {"type": "tool_result", "content": [IMG_ANTHROPIC]}]},
                "toolUseResult": IMG_TOOLUSE}),
            json.dumps({"type": "assistant", "message": {"role": "assistant", "content": [{"type": "text", "text": "bye"}]}}),
        ]

    def test_strips_and_backs_up(self):
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "abc.jsonl")
            with open(p, "w", encoding="utf-8") as f:
                f.write("\n".join(self._make_session_lines()) + "\n")
            rep = M.process_file(p, dry_run=False)
            self.assertEqual(rep.removed, 2)
            self.assertEqual(rep.touched_rows, [2])
            self.assertIsNotNone(rep.backup)
            self.assertTrue(os.path.exists(rep.backup))
            data = open(p, encoding="utf-8").read().splitlines()
            self.assertEqual(len(data), 4)  # 行数不变
            obj = json.loads(data[2])
            self.assertEqual(M.count_images(obj), 0)
            # 备份仍含原图
            bdata = open(rep.backup, encoding="utf-8").read().splitlines()
            self.assertEqual(M.count_images(json.loads(bdata[2])), 2)

    def test_dry_run_no_write(self):
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "abc.jsonl")
            with open(p, "w", encoding="utf-8") as f:
                f.write("\n".join(self._make_session_lines()) + "\n")
            rep = M.process_file(p, dry_run=True)
            self.assertEqual(rep.removed, 2)
            self.assertIsNone(rep.backup)
            obj = json.loads(open(p, encoding="utf-8").read().splitlines()[2])
            self.assertEqual(M.count_images(obj), 2)  # 原文件未改

    def test_no_image_is_noop(self):
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "abc.jsonl")
            with open(p, "w", encoding="utf-8") as f:
                f.write(json.dumps({"type": "user", "message": {"role": "user",
                      "content": [{"type": "text", "text": "hi"}]}}) + "\n")
            rep = M.process_file(p, dry_run=False)
            self.assertEqual(rep.removed, 0)
            self.assertIsNone(rep.backup)

    def test_invalid_json_row_preserved(self):
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "abc.jsonl")
            with open(p, "w", encoding="utf-8") as f:
                f.write("not json\n")
                f.write("\n".join(self._make_session_lines()[2:3]) + "\n")
            rep = M.process_file(p, dry_run=False)
            self.assertEqual(len(rep.errors), 1)
            self.assertEqual(rep.removed, 2)
            data = open(p, encoding="utf-8").read().splitlines()
            self.assertEqual(data[0], "not json")  # 坏行原样保留


class TestEncodeProjectDir(unittest.TestCase):
    def test_windows_path(self):
        self.assertEqual(M.encode_project_dir(r"E:\PyCode\iwencai"), "E--PyCode-iwencai")

    def test_unix_path(self):
        self.assertEqual(M.encode_project_dir("/home/user/proj"), "-home-user-proj")

    def test_dots_preserved_as_dash(self):
        self.assertEqual(M.encode_project_dir(r"C:\code\my.app"), "C--code-my-app")


if __name__ == "__main__":
    unittest.main(verbosity=2)
