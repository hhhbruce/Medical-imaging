"""Convert a DICOM CT series into a .vti volume file readable by vtk.js.

Usage:
    python convert_dicom_to_vti.py <input_dicom_dir> [output.vti]
"""
import sys
import vtk


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else (
        r"d:\Smart City\Medical-imaging\sample-data\2.000000-PRE LIVER-76970"
    )
    dst = sys.argv[2] if len(sys.argv) > 2 else "liver.vti"

    reader = vtk.vtkDICOMImageReader()
    reader.SetDirectoryName(src)
    reader.Update()
    img = reader.GetOutput()

    dims = img.GetDimensions()
    print(f"series: {src}")
    print(f"dims:   {dims}")
    print(f"spacing:{tuple(round(x, 4) for x in img.GetSpacing())}")
    print(f"range:  {img.GetScalarRange()}")

    writer = vtk.vtkXMLImageDataWriter()
    writer.SetFileName(dst)
    writer.SetInputData(img)
    writer.Write()
    print(f"wrote:  {dst}")


if __name__ == "__main__":
    main()
