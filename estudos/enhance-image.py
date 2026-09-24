import os
import cv2
import torch
import numpy as np
from basicsr.archs.rrdbnet_arch import RRDBNet
from realesrgan import RealESRGANer
from gfpgan import GFPGANer

class ImageEnhancer:
    def __init__(self, upscale=4, model_dir='weights'):
        self.upscale = upscale
        self.model_dir = model_dir
        os.makedirs(model_dir, exist_ok=True)
        
        # 初始化设备
        self.device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
        print(f"使用设备: {self.device}")
        
        # 加载 Real-ESRGAN 模型
        self._init_upsampler()
        # 加载 GFPGAN 人脸增强模型
        self._init_face_enhancer()

    def _init_upsampler(self):
        """初始化 Real-ESRGAN 放大器"""
        # 使用 RRDBNet 架构（x4plus 模型）
        model = RRDBNet(
            num_in_ch=3, num_out_ch=3, num_feat=64,
            num_block=23, num_grow_ch=32, scale=4
        )
        
        model_path = os.path.join(self.model_dir, 'RealESRGAN_x4plus.pth')
        
        # 如果模型不存在，尝试下载或提示
        if not os.path.exists(model_path):
            print(f"⚠️ 模型文件 {model_path} 不存在。")
            print("请从以下链接下载 RealESRGAN_x4plus.pth 并放入 weights 文件夹：")
            print("https://github.com/xinntao/Real-ESRGAN/releases")
            # 这里可以添加自动下载逻辑，但为了脚本简洁性，建议手动下载
        
        # 半精度 (FP16) 可提升速度并降低显存，但要求 GPU 支持
        half = torch.cuda.is_available()
        
        self.upsampler = RealESRGANer(
            scale=4,
            model_path=model_path,
            model=model,
            tile=0,          # 0 表示不分块。显存不足时设为 400
            tile_pad=10,
            pre_pad=0,
            half=half,
            device=self.device
        )

    def _init_face_enhancer(self):
        """初始化 GFPGAN 人脸增强器（可选）"""
        model_path = os.path.join(self.model_dir, 'GFPGANv1.4.pth')
        
        if not os.path.exists(model_path):
            print(f"⚠️ 人脸模型 {model_path} 不存在，将跳过人脸增强。")
            self.face_enhancer = None
            return
        
        self.face_enhancer = GFPGANer(
            model_path=model_path,
            upscale=4,
            arch='clean',
            channel_multiplier=2,
            bg_upsampler=self.upsampler,  # 背景也用 Real-ESRGAN 处理
            device=self.device
        )

    def enhance(self, input_path, output_path, face_enhance=True):
        """
        增强图像
        :param input_path: 输入图像路径
        :param output_path: 输出图像路径
        :param face_enhance: 是否启用人脸增强
        """
        # 读取图像（支持 RGBA）
        img = cv2.imread(input_path, cv2.IMREAD_UNCHANGED)
        if img is None:
            raise ValueError(f"无法读取图像: {input_path}")
        
        print(f"原始尺寸: {img.shape[1]}x{img.shape[0]}")
        
        # 如果图像太小，先稍微放大以避免模型不稳定
        h, w = img.shape[:2]
        if h < 300 or w < 300:
            img = cv2.resize(img, (w*2, h*2), interpolation=cv2.INTER_LANCZOS4)
        
        # 执行增强
        try:
            if face_enhance and self.face_enhancer is not None:
                # 使用 GFPGAN + Real-ESRGAN 组合
                _, _, output = self.face_enhancer.enhance(
                    img,
                    has_aligned=False,
                    only_center_face=False,
                    paste_back=True
                )
            else:
                # 仅使用 Real-ESRGAN
                output, _ = self.upsampler.enhance(img, outscale=self.upscale)
        except Exception as e:
            print(f"增强过程出错: {e}")
            # 降级方案：仅使用 Real-ESRGAN
            output, _ = self.upsampler.enhance(img, outscale=self.upscale)
        
        # 限制最大输出尺寸（防止内存溢出）
        h_out, w_out = output.shape[:2]
        max_size = 4000
        if max(h_out, w_out) > max_size:
            scale = max_size / max(h_out, w_out)
            output = cv2.resize(output, (int(w_out*scale), int(h_out*scale)), 
                              interpolation=cv2.INTER_LANCZOS4)
        
        # 保存结果
        cv2.imwrite(output_path, output)
        print(f"✅ 增强完成！输出尺寸: {output.shape[1]}x{output.shape[0]}")
        print(f"保存至: {output_path}")


if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description='Real-ESRGAN 图像增强')
    parser.add_argument('--input', '-i', type=str, required=True, help='输入图像路径')
    parser.add_argument('--output', '-o', type=str, default='output.png', help='输出图像路径')
    parser.add_argument('--no-face', action='store_true', help='禁用人脸增强')
    parser.add_argument('--upscale', type=int, default=4, choices=[2, 4], help='放大倍数')
    
    args = parser.parse_args()
    
    enhancer = ImageEnhancer(upscale=args.upscale)
    enhancer.enhance(args.input, args.output, face_enhance=not args.no_face)
    